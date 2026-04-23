import { createOpenAIProvider } from "./openai";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createMistralProvider } from "./mistral";
import { createCohereProvider } from "./cohere";
import {
  createAzureOpenAIProvider,
  createBedrockProvider,
  createDeepSeekProvider,
  createFireworksProvider,
  createGroqProvider,
  createLocalAIProvider,
  createOllamaProvider,
  createPerplexityProvider,
  createTogetherProvider,
  createVertexAIProvider,
  createXAIProvider,
} from "./compatProviders";
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
    case "cohere":
      return createCohereProvider(config);
    case "azure-openai":
      return createAzureOpenAIProvider(config);
    case "bedrock":
      return createBedrockProvider(config);
    case "vertex-ai":
      return createVertexAIProvider(config);
    case "groq":
      return createGroqProvider(config);
    case "fireworks":
      return createFireworksProvider(config);
    case "together":
      return createTogetherProvider(config);
    case "ollama":
      return createOllamaProvider(config);
    case "localai":
      return createLocalAIProvider(config);
    case "perplexity":
      return createPerplexityProvider(config);
    case "xai":
      return createXAIProvider(config);
    case "deepseek":
      return createDeepSeekProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
