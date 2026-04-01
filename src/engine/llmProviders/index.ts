import { createOpenAIProvider } from "./openai";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createMistralProvider } from "./mistral";
import { LLMProvider, LLMProviderConfig } from "./types";

export { LLMProviderConfig, LLMResponse, LLMProvider, PROVIDER_MODELS } from "./types";

/**
 * Returns a callable LLM provider function for the given config.
 * Throws if the provider name is unrecognised.
 */
export function getProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
    case "gemini":
      return createGeminiProvider(config);
    case "mistral":
      return createMistralProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
