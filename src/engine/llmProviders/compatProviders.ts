import { LLMProvider, LLMProviderConfig } from "./types";
import { createOpenAICompatibleProvider } from "./openaiCompatible";
export { createBedrockProvider } from "./bedrock";
export { createVertexAIProvider } from "./vertexAi";

export function createGroqProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
  });
}

export function createOpenCodeZenProvider(config: LLMProviderConfig): LLMProvider {
  // OpenCode Zen exposes an OpenAI-compatible chat-completions endpoint at
  // /zen/v1. Used by the hosted free tier (Big Pickle stealth model) —
  // see src/hostedFreeModels/providers.ts.
  return createOpenAICompatibleProvider(config, {
    label: "OpenCode Zen",
    baseURL: "https://opencode.ai/zen/v1",
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
