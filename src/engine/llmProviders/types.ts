/**
 * Shared types for the LLM provider adapter layer.
 */

export const PROVIDER_NAMES = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "azure-openai",
  "bedrock",
  "vertex-ai",
  "groq",
  "fireworks",
  "together",
  "ollama",
  "localai",
  "cohere",
  "perplexity",
  "xai",
  "deepseek",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface LLMProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  credentials?: {
    apiKey?: string;
  };
  options?: Record<string, string | undefined>;
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
  "azure-openai": [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
  ],
  bedrock: [
    "amazon.nova-micro-v1:0",
    "amazon.nova-lite-v1:0",
    "amazon.nova-pro-v1:0",
  ],
  "vertex-ai": [
    "gemini-1.5-flash-002",
    "gemini-1.5-pro-002",
    "claude-3-5-sonnet-v2@20241022",
  ],
  groq: [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "mixtral-8x7b-32768",
  ],
  fireworks: [
    "accounts/fireworks/models/llama-v3p1-8b-instruct",
    "accounts/fireworks/models/llama-v3p1-70b-instruct",
    "accounts/fireworks/models/deepseek-r1",
  ],
  together: [
    "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-R1",
  ],
  ollama: [
    "llama3.2",
    "llama3.1:70b",
    "deepseek-r1:14b",
  ],
  localai: [
    "llama-3.2-3b-instruct",
    "llama-3.1-8b-instruct",
    "llama-3.1-70b-instruct",
  ],
  cohere: [
    "command-r7b-12-2024",
    "command-r-plus-08-2024",
    "command-a-03-2025",
  ],
  perplexity: [
    "sonar",
    "sonar-pro",
    "sonar-reasoning-pro",
  ],
  xai: [
    "grok-2-1212",
    "grok-3-mini-beta",
    "grok-3-beta",
  ],
  deepseek: [
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-coder",
  ],
};
