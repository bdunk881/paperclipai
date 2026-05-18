import Anthropic from "@anthropic-ai/sdk";
import {
  AgentTool,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

/**
 * Anthropic doesn't expose a `response_format` knob — the recommended
 * way to force JSON is to define a tool whose input_schema is the
 * desired shape and then `tool_choice` that tool. The model then
 * "calls" the tool with a `tool_use` block whose `input` is a
 * structured object matching the schema.
 *
 * We expose that as `{ type: "json_object" | "json_schema" }` so the
 * caller doesn't have to know about Claude's tool-use mechanic.
 *
 * Returns null when no structured output was requested, in which case
 * the normal text path runs.
 */
const FORCED_TOOL_NAME = "respond_with_json";

function toAnthropicForcedTool(
  responseFormat: ResponseFormat | undefined,
):
  | {
      tools: Anthropic.Messages.Tool[];
      tool_choice: { type: "tool"; name: string };
    }
  | null {
  if (!responseFormat || responseFormat.type === "text") return null;
  const schema =
    responseFormat.type === "json_schema"
      ? responseFormat.schema
      : // Permissive shape for json_object mode — the model still
        // produces a structured object, just without a schema check.
        ({ type: "object", additionalProperties: true } as Record<string, unknown>);
  return {
    tools: [
      {
        name: FORCED_TOOL_NAME,
        description:
          "Respond with a structured JSON object matching the input_schema. Do not return prose.",
        input_schema: schema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: FORCED_TOOL_NAME },
  };
}

export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  const apiKey = config.apiKey ?? config.credentials?.apiKey;
  if (!apiKey) {
    throw new Error(`Anthropic API error: missing API key credentials for ${config.provider}`);
  }

  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Anthropic's SDK default is 10 minutes, but we want a uniform ceiling
  // across providers so a slow Claude call can't outlive our Express
  // request budget.
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;
  const client = new Anthropic({ apiKey, timeout: timeoutMs });
  const forcedTool = toAnthropicForcedTool(config.responseFormat);

  return async (prompt: string): Promise<LLMResponse> => {
    // Agentic tool-loop path (DASH-22). When `tools` is set the
    // model can emit tool_use blocks; we invoke the matching handler
    // and feed tool_result back until the model stops calling tools
    // or we hit maxToolIterations. JSON-mode (forcedTool) is
    // intentionally not combined with this path — they use the same
    // tool primitive in opposite ways.
    if (config.tools && config.tools.length > 0 && !forcedTool) {
      return runAnthropicToolLoop({
        client,
        model: config.model,
        prompt,
        tools: config.tools,
        maxIterations: config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
      });
    }

    // Streaming path: caller wired an onText callback to forward
    // incremental deltas (e.g. SSE → agent presence pill). Use the
    // Anthropic SDK's `messages.stream` helper so we still get the
    // final assembled message + usage when the stream completes.
    //
    // Streaming is incompatible with forced-tool JSON mode in a
    // straightforward way (we'd have to assemble tool_use blocks from
    // input_json_delta events). When `responseFormat` is set, skip the
    // stream and fall through to the standard create() call so
    // structured-output callers continue to get clean JSON.
    if (config.onText && !forcedTool) {
      let accumulated = "";
      const onText = config.onText;
      try {
        const stream = client.messages.stream({
          model: config.model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        });
        stream.on("text", (delta) => {
          accumulated += delta;
          try {
            onText(delta, accumulated);
          } catch {
            // Swallow callback errors — streaming UX shouldn't break
            // the LLM call. The final response below is what callers
            // actually consume.
          }
        });
        const final = await stream.finalMessage();
        const usage = {
          promptTokens: final.usage.input_tokens,
          completionTokens: final.usage.output_tokens,
        };
        const firstBlock = final.content[0];
        const text =
          firstBlock?.type === "text" ? firstBlock.text : accumulated;
        return { text, usage };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Anthropic API error: ${msg}`);
      }
    }

    let response;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        ...(forcedTool ?? {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic API error: ${msg}`);
    }

    // When forced tool-use is in effect, the response carries a
    // `tool_use` block whose `input` is the structured JSON object.
    // Serialize it back to a string so the shared `LLMResponse.text`
    // contract holds for every caller — the Tier 1 extractor will
    // parse it back without doing any heuristic work.
    let text = "";
    if (forcedTool) {
      const toolBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use" && block.name === FORCED_TOOL_NAME,
      );
      if (toolBlock) {
        text = JSON.stringify(toolBlock.input);
      }
    }
    if (!text) {
      const firstBlock = response.content[0];
      text = firstBlock?.type === "text" ? firstBlock.text : "";
    }

    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };

    return { text, usage };
  };
}

/**
 * DASH-22: Anthropic agentic tool loop.
 *
 * Runs `messages.create` in a loop:
 *   1. Send the conversation so far + tool defs.
 *   2. If the response has `stop_reason === "tool_use"`, gather every
 *      tool_use block, invoke each handler concurrently, append the
 *      assistant turn + the corresponding user-role tool_result turn
 *      to the conversation, and loop.
 *   3. Otherwise (`end_turn`, `max_tokens`, etc.) — return the final
 *      assistant text + cumulative usage.
 *
 * Tool handler failures are surfaced to the model as a `tool_result`
 * with `is_error: true` so the model can recover (try a different
 * tool, or apologize to the user). They do NOT throw out of the loop.
 *
 * The cap is intentionally tight (8 by default). Real-world agentic
 * tasks finish in 2-4 iterations; anything past that is usually a
 * runaway loop. The model gets a final summarize-only turn when the
 * cap fires so the caller always receives readable text.
 */
async function runAnthropicToolLoop(args: {
  client: Anthropic;
  model: string;
  prompt: string;
  tools: AgentTool[];
  maxIterations: number;
}): Promise<LLMResponse> {
  const toolsByName = new Map(args.tools.map((t) => [t.name, t]));
  const anthropicTools: Anthropic.Messages.Tool[] = args.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: args.prompt },
  ];

  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;

  for (let iteration = 0; iteration < args.maxIterations; iteration++) {
    let response: Anthropic.Messages.Message;
    try {
      response = await args.client.messages.create({
        model: args.model,
        max_tokens: 4096,
        messages,
        tools: anthropicTools,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic API error: ${msg}`);
    }

    cumulativePromptTokens += response.usage.input_tokens;
    cumulativeCompletionTokens += response.usage.output_tokens;

    // Always append the assistant turn so the next loop iteration
    // (or the final return) has the full transcript.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = extractAssistantText(response.content);
      return {
        text,
        usage: {
          promptTokens: cumulativePromptTokens,
          completionTokens: cumulativeCompletionTokens,
        },
      };
    }

    // Gather every tool_use block in this turn (Anthropic may emit
    // more than one) and run them in parallel.
    const toolUses = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use",
    );

    const toolResults = await Promise.all(
      toolUses.map(async (use) => {
        const tool = toolsByName.get(use.name);
        if (!tool) {
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: `Tool "${use.name}" is not registered. Try a different tool or finish without it.`,
            is_error: true,
          };
        }
        try {
          const input = (use.input ?? {}) as Record<string, unknown>;
          const result = await tool.handler(input);
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content:
              typeof result === "string" ? result : JSON.stringify(result),
          };
        } catch (handlerErr) {
          const msg =
            handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: `Tool "${use.name}" failed: ${msg}`,
            is_error: true,
          };
        }
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  // Iteration cap exceeded: ask the model to wrap up without tools.
  // This is best-effort; if the wrap-up itself errors we surface the
  // last assistant text we already accumulated.
  try {
    const finalTurn = await args.client.messages.create({
      model: args.model,
      max_tokens: 1024,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Maximum tool iterations reached. Summarize what you accomplished and what's still pending in 1-3 sentences. Do not call any tools.",
        },
      ],
    });
    cumulativePromptTokens += finalTurn.usage.input_tokens;
    cumulativeCompletionTokens += finalTurn.usage.output_tokens;
    const text =
      extractAssistantText(finalTurn.content) ||
      "[interrupted: max iterations]";
    return {
      text: `${text}\n\n[interrupted: max iterations]`,
      usage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
      },
    };
  } catch {
    return {
      text: "[interrupted: max iterations]",
      usage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
      },
    };
  }
}

function extractAssistantText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
