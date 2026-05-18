import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

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
