import { LLMProvider, LLMProviderConfig } from "./types";
import { createOpenAICompatibleProvider } from "./openaiCompatible";
export { createBedrockProvider } from "./bedrock";
export { createVertexAIProvider } from "./vertexAi";

export function createAzureOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Azure OpenAI",
    baseURLEnvVar: "AZURE_OPENAI_BASE_URL",
    resolveBaseURL: (providerConfig) => {
      const endpoint = providerConfig.options?.endpoint?.replace(/\/+$/, "");
      const deployment = providerConfig.options?.deployment;
      if (!endpoint || !deployment) {
        return undefined;
      }
      return `${endpoint}/openai/deployments/${deployment}`;
    },
    resolveModel: (providerConfig) =>
      providerConfig.options?.deployment ?? providerConfig.model,
  });
}

export function createGroqProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
  });
}

export function createFireworksProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Fireworks AI",
    baseURL: "https://api.fireworks.ai/inference/v1",
  });
}

export function createTogetherProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Together AI",
    baseURL: "https://api.together.xyz/v1",
  });
}

export function createOllamaProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
  });
}

export function createLocalAIProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "LocalAI",
    baseURL: "http://127.0.0.1:8080/v1",
  });
}

export function createPerplexityProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Perplexity",
    baseURL: "https://api.perplexity.ai",
  });
}

export function createXAIProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "xAI",
    baseURL: "https://api.x.ai/v1",
  });
}

export function createDeepSeekProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
  });
}
