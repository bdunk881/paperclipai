/**
 * OpenAI provider adapter (HEL-82).
 *
 * Translates the normalized request shape to OpenAI's Chat Completions API
 * (`/v1/chat/completions`) and the response back. Handles tool calls + native
 * JSON-schema structured outputs (`response_format: { type: "json_schema" }`).
 *
 * Uses fetch directly (no SDK) so we don't pull in additional deps for the
 * smaller call surface this adapter exposes.
 */

import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
} from "./types";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChatChoice {
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null;
}

interface OpenAIChatResponse {
  id: string;
  choices: OpenAIChatChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;

  async invoke(request: NormalizedRequest): Promise<NormalizedResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("OpenAI adapter: API key is required");
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

    // Translate tools to OpenAI function-tool shape
    const tools = (request.tools ?? []).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Native structured output via JSON schema (OpenAI Chat Completions)
    let response_format: Record<string, unknown> | undefined;
    if (request.responseSchema) {
      response_format = {
        type: "json_schema",
        json_schema: {
          name: request.responseSchema.name,
          schema: request.responseSchema.schema,
          strict: true,
        },
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

    let raw: OpenAIChatResponse;
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI adapter API error: ${res.status} ${text.slice(0, 500)}`);
      }
      raw = (await res.json()) as OpenAIChatResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI adapter API error: ${msg}`);
    }

    const choice = raw.choices[0];
    const content = choice?.message?.content ?? "";

    const toolCalls: NormalizedToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        // OpenAI sometimes returns a string fragment mid-stream; treat as empty
        parsedArgs = {};
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
      };
    });

    const cachedInputTokens = raw.usage.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: raw.usage.prompt_tokens,
        outputTokens: raw.usage.completion_tokens,
        cachedInputTokens: cachedInputTokens || undefined,
      },
      finishReason: mapOpenAIFinish(choice?.finish_reason),
      cacheHit: cachedInputTokens > 0,
      raw,
    };
  }
}

function mapOpenAIFinish(reason: OpenAIChatChoice["finish_reason"]) {
  switch (reason) {
    case "stop":
      return "stop" as const;
    case "length":
      return "length" as const;
    case "tool_calls":
      return "tool_calls" as const;
    case "function_call":
      return "tool_calls" as const;
    case "content_filter":
      return "content_filter" as const;
    default:
      return "unknown" as const;
  }
}
