/**
 * Anthropic provider adapter (HEL-82).
 *
 * Translates the normalized request shape to Anthropic's Messages API and
 * the response back. Handles tool use + structured outputs.
 *
 * Structured outputs strategy: Anthropic's Messages API doesn't have a
 * dedicated JSON-schema response format. The standard pattern is to define
 * a single tool whose `input_schema` is the desired schema, force the
 * model to call that tool, and read the structured arguments back. Done
 * automatically when `responseSchema` is set.
 */

import Anthropic from "@anthropic-ai/sdk";

import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

const STRUCTURED_OUTPUT_TOOL_NAME = "__structured_output__";

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Anthropic adapter: API key is required");
    }

    const client = new Anthropic({ apiKey });

    // Translate messages into Anthropic format. System messages go into
    // the dedicated `system` field; tool results become user messages with
    // tool_result content blocks.
    const anthropicMessages: Anthropic.MessageParam[] = [];
    let systemPrompt = request.system ?? "";

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemPrompt = [systemPrompt, msg.content].filter(Boolean).join("\n\n");
        continue;
      }

      if (msg.role === "tool" && msg.toolResults?.length) {
        anthropicMessages.push({
          role: "user",
          content: msg.toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError === true,
          })),
        });
        continue;
      }

      if (msg.role === "user") {
        anthropicMessages.push({ role: "user", content: msg.content ?? "" });
        continue;
      }

      if (msg.role === "assistant") {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (msg.content) blocks.push({ type: "text", text: msg.content });
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthropicMessages.push({ role: "assistant", content: blocks });
      }
    }

    // Translate tools (including the synthetic structured-output tool if needed).
    const tools: Anthropic.Tool[] = (request.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    let toolChoice: Anthropic.MessageCreateParams["tool_choice"] | undefined;
    if (request.responseSchema) {
      tools.push({
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description:
          "Emit the final structured output. Always call this tool exactly once with the response data.",
        input_schema: request.responseSchema.schema as Anthropic.Tool["input_schema"],
      });
      toolChoice = { type: "tool", name: STRUCTURED_OUTPUT_TOOL_NAME };
    }

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: toolChoice,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anthropic adapter API error: ${msg}`);
    }

    // Parse response blocks
    let content = "";
    const toolCalls: NormalizedToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments:
            typeof block.input === "object" && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens:
          typeof (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ===
          "number"
            ? (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens
            : undefined,
      },
      finishReason: mapAnthropicStopReason(response.stop_reason),
      cacheHit: Boolean(
        (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens &&
          ((response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0) > 0,
      ),
      raw: response,
    };
  }
}

function mapAnthropicStopReason(reason: Anthropic.Message["stop_reason"]) {
  switch (reason) {
    case "end_turn":
      return "stop" as const;
    case "max_tokens":
      return "length" as const;
    case "tool_use":
      return "tool_calls" as const;
    case "stop_sequence":
      return "stop" as const;
    default:
      return "unknown" as const;
  }
}
