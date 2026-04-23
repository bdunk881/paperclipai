import OpenAI from "openai";
import { LLMProvider, LLMProviderConfig, LLMResponse } from "./types";

interface OpenAICompatibleOptions {
  label: string;
  baseURL?: string;
  baseURLEnvVar?: string;
  resolveBaseURL?: (config: LLMProviderConfig) => string | undefined;
  resolveModel?: (config: LLMProviderConfig) => string;
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

  const client = new OpenAI({
    apiKey: resolvedApiKey,
    ...(resolvedBaseURL ? { baseURL: resolvedBaseURL } : {}),
  });

  return async (prompt: string): Promise<LLMResponse> => {
    let response;
    try {
      response = await client.chat.completions.create({
        model: resolvedModel,
        messages: [{ role: "user", content: prompt }],
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
