import OpenAI from "openai";
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

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.chat.completions.create({
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${options.label} API error: ${msg}`);
    }

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined;

    return { text, usage };
  };
}
