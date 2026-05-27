import OpenAI from "openai";
import { emitTrace, resolveTraceCallback } from "../agentTrace/emitCallbacks";
import {
  createOpenAIStreamAccumulators,
  mapOpenAIStreamChunk,
  resetOpenAIToolCallAccum,
} from "./openaiStream";
import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  ResponseFormat,
} from "./types";

interface OpenAICompatibleOptions {
  label: string;
  baseURL?: string;
  baseURLEnvVar?: string;
  resolveBaseURL?: (config: LLMProviderConfig) => string | undefined;
  resolveModel?: (config: LLMProviderConfig) => string;
}

/**
 * Convert our provider-agnostic ResponseFormat into the OpenAI
 * Chat Completions API's `response_format` shape. Returns undefined
 * when the caller didn't ask for structured output, in which case
 * we let the model choose.
 */
function toOpenAIResponseFormat(
  responseFormat: ResponseFormat | undefined,
): OpenAI.Chat.ChatCompletionCreateParams["response_format"] | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") {
    return { type: "json_object" };
  }
  // json_schema — every modern OpenAI-compat endpoint (OpenAI, Groq,
  // Fireworks, xAI, DeepSeek, OpenCode Zen) accepts this shape. Older
  // ones (Ollama on certain versions, perplexity for non-sonar models)
  // may 400; the caller's outer try/catch + Tier 1 extractor pickup
  // covers that case.
  return {
    type: "json_schema",
    json_schema: {
      name: responseFormat.name ?? "response",
      schema: responseFormat.schema,
      strict: true,
    },
  };
}

export function createOpenAICompatibleProvider(
  config: LLMProviderConfig,
  options: OpenAICompatibleOptions
): LLMProvider {
  const resolvedBaseURL =
    options.resolveBaseURL?.(config) ??
    options.baseURL ??
    (options.baseURLEnvVar ? process.env[options.baseURLEnvVar] : undefined);
  const resolvedApiKey = config.apiKey ?? config.credentials?.apiKey;
  const resolvedModel = options.resolveModel?.(config) ?? config.model;

  if (options.baseURLEnvVar && !resolvedBaseURL) {
    throw new Error(
      `${options.label} API error: set ${options.baseURLEnvVar} before using ${config.provider}`
    );
  }
  if (!resolvedApiKey) {
    throw new Error(
      `${options.label} API error: missing API key credentials for ${config.provider}`
    );
  }

  // Explicit per-request timeout — see DEFAULT_LLM_REQUEST_TIMEOUT_MS.
  // Covers every OpenAI-compat provider (OpenAI, Groq, Fireworks,
  // Together, xAI, DeepSeek, Perplexity, Ollama, LocalAI, OpenCode Zen).
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;

  const client = new OpenAI({
    apiKey: resolvedApiKey,
    timeout: timeoutMs,
    ...(resolvedBaseURL ? { baseURL: resolvedBaseURL } : {}),
  });

  const responseFormat = toOpenAIResponseFormat(config.responseFormat);

  /**
   * HEL-145: Build the messages array, optionally prefixed with a
   * system-role message. Pulled into a helper so every code path
   * (streaming, tool loop, single-call) builds it the same way.
   *
   * OpenAI's prompt cache is automatic for prefixes > ~1024 tokens
   * with no per-call opt-in — sending the system prompt as a
   * dedicated message is all that's required for the cache to kick in
   * on repeat calls within the TTL window. The `cacheSystemPrompt`
   * flag from LLMProviderConfig is accepted for cross-provider API
   * consistency but is a no-op here.
   */
  function buildMessages(
    userPrompt: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (config.systemPrompt) {
      messages.push({ role: "system", content: config.systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });
    return messages;
  }

  return async (prompt: string): Promise<LLMResponse> => {
    const onTrace = resolveTraceCallback(config);

    // HEL-82: the agentic tool-loop is implemented in
    // src/agents/runtime/fallbackAgentBackend.ts on top of the
    // NormalizedRequest adapters. This provider is now bare-API only —
    // one-shot text or native JSON-mode (responseFormat). If `tools`
    // is passed it's a caller mistake.
    if (config.tools && config.tools.length > 0 && !responseFormat) {
      throw new Error(
        "createOpenAICompatibleProvider: legacy `tools`/tool-loop path retired. " +
          "Route agent runs through src/agents/runtime/runAgent.ts (FallbackAgentBackend) instead.",
      );
    }

    // Streaming path: caller supplied onTrace / onText. Use the
    // chat-completions stream and accumulate text deltas across
    // chunks. Skipped when JSON-mode is in effect — structured
    // responses arrive as a single content blob, streaming the
    // delta-by-delta JSON isn't useful for the presence pill.
    if (onTrace && !responseFormat) {
      const acc = createOpenAIStreamAccumulators();
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedPromptTokens: number | undefined;
      try {
        const stream = await client.chat.completions.create({
          model: resolvedModel,
          messages: buildMessages(prompt),
          stream: true,
          stream_options: { include_usage: true },
          ...(typeof config.maxOutputTokens === "number"
            ? { max_tokens: config.maxOutputTokens }
            : {}),
        });
        for await (const chunk of stream) {
          mapOpenAIStreamChunk(chunk, onTrace, acc);
          if (chunk.usage) {
            const buckets = extractOpenAICacheBucket(chunk.usage);
            promptTokens = buckets.promptTokens;
            completionTokens = chunk.usage.completion_tokens;
            if (buckets.cachedPromptTokens !== undefined) {
              cachedPromptTokens = buckets.cachedPromptTokens;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${options.label} API error: ${msg}`);
      }
      const usage = { promptTokens, completionTokens, cachedPromptTokens };
      emitTrace(onTrace, {
        type: "turn.completed",
        text: acc.assistantText,
        usage,
      });
      return {
        text: acc.assistantText,
        usage,
      };
    }

    let response;
    try {
      response = await client.chat.completions.create({
        model: resolvedModel,
        messages: buildMessages(prompt),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(typeof config.maxOutputTokens === "number"
          ? { max_tokens: config.maxOutputTokens }
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${options.label} API error: ${msg}`);
    }

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage
      ? (() => {
          const buckets = extractOpenAICacheBucket(response.usage!);
          return {
            promptTokens: buckets.promptTokens,
            completionTokens: response.usage!.completion_tokens,
            cachedPromptTokens: buckets.cachedPromptTokens,
          };
        })()
      : undefined;

    return { text, usage };
  };
}

/**
 * HEL-145 followup (Codex review iteration 2 on PR #898): the revised
 * contract is that `promptTokens` is the TOTAL input count (matches
 * legacy semantics), and `cachedPromptTokens` is the cached SUB-bucket.
 *
 * OpenAI already returns `prompt_tokens` as the total (cached portion
 * is included), so we pass it through unchanged. The cache sub-bucket
 * comes from `prompt_tokens_details.cached_tokens` when present.
 *
 * This keeps every existing cost-logger correct on cache hits — they
 * read `promptTokens` and continue to see the full input count.
 * Cache-aware billing can subtract `cachedPromptTokens` to apply the
 * discounted rate.
 */
function extractOpenAICacheBucket(
  usage: OpenAI.Completions.CompletionUsage,
): { promptTokens: number; cachedPromptTokens: number | undefined } {
  const details = (usage as { prompt_tokens_details?: { cached_tokens?: number | null } })
    .prompt_tokens_details;
  const cached =
    details && typeof details.cached_tokens === "number" && details.cached_tokens > 0
      ? details.cached_tokens
      : undefined;
  return {
    promptTokens: usage.prompt_tokens,
    cachedPromptTokens: cached,
  };
}

