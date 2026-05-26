/**
 * Generic OpenAI-compatible adapter (HEL-224).
 *
 * The OpenAI Chat Completions wire format is the lingua franca for most
 * of the long-tail provider ecosystem — groq, fireworks, together, xai,
 * perplexity, deepseek, ollama, localai, opencode_zen all speak it with
 * just a different base URL. This class is a thin parameterized clone
 * of `OpenAIAdapter` that takes the provider name + base URL at
 * construction so each long-tail provider gets registered once in
 * `index.ts` without any new code per provider.
 *
 * Differences from native OpenAI:
 *   - `prompt_tokens_details.cached_tokens` is OpenAI-only; we read it
 *     defensively (most long-tail providers omit it).
 *   - Some providers (Perplexity, DeepSeek) host the chat endpoint at
 *     the root path; others (Groq, xAI, Together, Fireworks, OpenCode
 *     Zen) prefix it with `/v1`. We accept either and append
 *     `/chat/completions` only when the base URL doesn't already
 *     contain it.
 */

import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type { ProviderName } from "../../engine/llmProviders/types";
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

function joinUrl(base: string, path: string): string {
  if (base.includes("/chat/completions")) return base;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path}`;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider: ProviderName;
  private readonly baseUrl: string;
  private readonly displayName: string;
  private readonly supportsResponseSchema: boolean;

  constructor(input: {
    provider: ProviderName;
    baseUrl: string;
    displayName: string;
    /**
     * Whether the provider supports `response_format: { type: "json_schema" }`.
     * Most do; some (Ollama / LocalAI on older builds, certain hosted
     * gateways) ignore it. Default true; the caller can pass false to
     * fall back to prompt-only structured output.
     */
    supportsResponseSchema?: boolean;
  }) {
    this.provider = input.provider;
    this.baseUrl = input.baseUrl;
    this.displayName = input.displayName;
    this.supportsResponseSchema = input.supportsResponseSchema ?? true;
  }

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
      throw new Error(`${this.displayName} adapter: API key is required`);
    }

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

    const tools = (request.tools ?? []).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let response_format: Record<string, unknown> | undefined;
    if (request.responseSchema && this.supportsResponseSchema) {
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

    const url = joinUrl(this.baseUrl, "/chat/completions");
    let raw: OpenAIChatResponse;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `${this.displayName} adapter API error: ${res.status} ${text.slice(0, 500)}`,
        );
      }
      raw = (await res.json()) as OpenAIChatResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${this.displayName} adapter API error: ${msg}`);
    }

    const choice = raw.choices[0];
    const content = choice?.message?.content ?? "";

    const toolCalls: NormalizedToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
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
      finishReason: mapFinishReason(choice?.finish_reason),
      cacheHit: cachedInputTokens > 0,
      raw,
    };
  }
}

function mapFinishReason(reason: OpenAIChatChoice["finish_reason"]) {
  switch (reason) {
    case "stop":
      return "stop" as const;
    case "length":
      return "length" as const;
    case "tool_calls":
    case "function_call":
      return "tool_calls" as const;
    case "content_filter":
      return "content_filter" as const;
    default:
      return "unknown" as const;
  }
}
