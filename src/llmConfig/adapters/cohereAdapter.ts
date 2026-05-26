/**
 * Cohere provider adapter (HEL-82).
 *
 * Translates the normalized request shape to Cohere's v2 Chat API
 * (`POST https://api.cohere.com/v2/chat`) and the response back. Handles tool
 * calls + structured outputs via `response_format: { type: "json_object", schema }`.
 *
 * Uses fetch directly (no SDK) — mirrors the legacy `engine/llmProviders/cohere.ts`
 * shape and matches the lightweight style of `openaiAdapter.ts`.
 */

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

interface CohereToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface CohereContentBlock {
  type?: string;
  text?: string;
}

interface CohereChatResponse {
  id: string;
  message: {
    role: "assistant";
    content?: CohereContentBlock[];
    tool_calls?: CohereToolCall[];
    tool_plan?: string;
  };
  finish_reason?: string;
  usage?: {
    tokens?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

export class CohereAdapter implements ProviderAdapter {
  readonly provider = "cohere" as const;

  async invokeStream(request: NormalizedRequest): Promise<NormalizedResponse> {
    const response = await this.invoke(request);
    if (request.onTrace && response.content) {
      emitTrace(request.onTrace, {
        type: "assistant.delta",
        delta: response.content,
        accumulated: response.content,
      });
      emitTrace(request.onTrace, {
        type: "turn.completed",
        text: response.content,
        usage: {
          promptTokens: response.usage.inputTokens,
          completionTokens: response.usage.outputTokens,
        },
      });
    }
    return response;
  }

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Cohere adapter: API key is required");
    }

    // Translate messages
    const messages: Array<Record<string, unknown>> = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    for (const msg of request.messages) {
      if (msg.role === "system") {
        messages.push({ role: "system", content: msg.content ?? "" });
        continue;
      }
      if (msg.role === "tool" && msg.toolResults?.length) {
        for (const r of msg.toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: r.toolCallId,
            content: r.content,
          });
        }
        continue;
      }
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content ?? "" });
        continue;
      }
      if (msg.role === "assistant") {
        const m: Record<string, unknown> = { role: "assistant" };
        if (msg.content) m.content = msg.content;
        if (msg.toolCalls?.length) {
          m.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        messages.push(m);
      }
    }

    // Translate tools — Cohere v2 accepts the OpenAI-compatible function shape.
    const tools = (request.tools ?? []).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Structured output via JSON schema (Cohere v2).
    let response_format: Record<string, unknown> | undefined;
    if (request.responseSchema) {
      response_format = {
        type: "json_object",
        schema: request.responseSchema.schema,
      };
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    };
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (tools.length > 0) body.tools = tools;
    if (response_format) body.response_format = response_format;

    let raw: CohereChatResponse;
    try {
      const res = await fetch("https://api.cohere.com/v2/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Cohere adapter API error: ${res.status} ${text.slice(0, 500)}`);
      }
      raw = (await res.json()) as CohereChatResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cohere adapter API error: ${msg}`);
    }

    // Concatenate text content blocks.
    const content = (raw.message?.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("");

    const toolCalls: NormalizedToolCall[] = (raw.message?.tool_calls ?? []).map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        // Defensive: treat malformed JSON as an empty argument object.
        parsedArgs = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
      };
    });

    const inputTokens = raw.usage?.tokens?.input_tokens ?? 0;
    const outputTokens = raw.usage?.tokens?.output_tokens ?? 0;

    return {
      content,
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        // Cohere doesn't report cached tokens.
      },
      finishReason: mapCohereFinish(raw.finish_reason),
      raw,
    };
  }
}

function mapCohereFinish(reason: string | undefined) {
  switch (reason) {
    case "COMPLETE":
      return "stop" as const;
    case "MAX_TOKENS":
      return "length" as const;
    case "TOOL_CALL":
      return "tool_calls" as const;
    case "ERROR":
      return "error" as const;
    default:
      return "unknown" as const;
  }
}
