/**
 * Shared types for the LLM provider adapter layer.
 */

export type ProviderName = "openai" | "anthropic" | "gemini" | "mistral";
export type InferenceGeo = "us" | "eu";

export interface LLMProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  inferenceGeo?: InferenceGeo;
}

export interface LLMResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/** Callable returned by getProvider — takes a prompt and returns an LLMResponse */
export type LLMProvider = (prompt: string) => Promise<LLMResponse>;

/** Available models per provider — used by frontend dropdowns */
export const PROVIDER_MODELS: Record<ProviderName, string[]> = {
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
  ],
  anthropic: [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ],
  gemini: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-small-latest",
    "open-mistral-7b",
  ],
};
