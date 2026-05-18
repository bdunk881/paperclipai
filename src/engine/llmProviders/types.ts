/**
 * Shared types for the LLM provider adapter layer.
 */

export const PROVIDER_NAMES = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
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
  // OpenAI-compatible. Used by the hosted free tier (Big Pickle) — see
  // src/hostedFreeModels/providers.ts.
  "opencode_zen",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface LLMProviderCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  serviceAccountJson?: string;
  oauthAccessToken?: string;
}

export interface LLMProviderCredentialSummary {
  apiKeyMasked?: string;
  accessKeyIdMasked?: string;
  secretAccessKeyMasked?: string;
  sessionTokenMasked?: string;
  serviceAccountJsonMasked?: string;
  oauthAccessTokenMasked?: string;
}

export interface LLMProviderOptions {
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
  region?: string;
  projectId?: string;
  location?: string;
  authType?: "api_key" | "aws" | "service_account" | "oauth";
}

/**
 * Structured-output mode. Lets a caller ask the provider to enforce
 * JSON output natively instead of begging in the prompt. Each provider
 * maps this to its closest native primitive:
 *
 *   - OpenAI / OpenAI-compat (Groq, Fireworks, Together, xAI, DeepSeek,
 *     Perplexity, Ollama, LocalAI, OpenCode Zen):
 *       json_object  → response_format: { type: "json_object" }
 *       json_schema  → response_format: { type: "json_schema", json_schema: {…, strict: true} }
 *   - Anthropic:
 *       json_object  → forced tool-use with a permissive {} schema
 *       json_schema  → forced tool-use with the provided JSON schema as input_schema
 *   - Mistral:
 *       json_object  → response_format: { type: "json_object" }
 *       json_schema  → response_format: { type: "json_schema", jsonSchema: {…} }
 *   - Gemini:
 *       json_object  → generationConfig: { responseMimeType: "application/json" }
 *       json_schema  → generationConfig: { responseMimeType, responseSchema }
 *
 * Providers that don't (yet) have a native mode (Bedrock, Vertex AI,
 * Cohere) ignore the hint — the caller still gets text and falls back
 * to the shared extractStructuredOutput helper.
 *
 * `name` is used by OpenAI for the schema label (`response_format
 * .json_schema.name`); other providers ignore it.
 */
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      name?: string;
      // JSON Schema (Draft-07-ish) object. Callers using zod should
      // convert with `zod-to-json-schema` or hand-author the schema.
      schema: Record<string, unknown>;
    };

/**
 * Default per-request timeout applied to every LLM provider SDK that
 * accepts one. Pre-fix Mistral was using the underlying fetch default
 * and aborting heavy team-assembly calls before the model responded
 * ("Mistral API error: Request timed out: TimeoutError" on /hire).
 *
 * 120s is comfortably above observed p99 for the heaviest call site
 * across providers (mistral-large-latest, claude-opus, gpt-4o on the
 * team-assembly prompt) while still keeping a hung backend from
 * spinning forever. Callers can override per call via
 * LLMProviderConfig.requestTimeoutMs — useful for cheap classification
 * steps that should fail fast, or for very long agentic runs.
 */
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120_000;

export interface LLMProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  credentials?: LLMProviderCredentials;
  options?: LLMProviderOptions;
  /**
   * Optional structured-output enforcement. See ResponseFormat. When
   * provided, the provider call uses its native JSON-mode primitive
   * (rather than relying on prompt instructions) for any provider that
   * supports one. Providers without native support ignore the hint.
   */
  responseFormat?: ResponseFormat;
  /**
   * Optional per-request timeout in ms, passed to the provider SDK's
   * native timeout knob (OpenAI/Anthropic `timeout`, Gemini
   * `requestOptions.timeout`, Mistral `timeoutMs`). Defaults to
   * DEFAULT_LLM_REQUEST_TIMEOUT_MS when omitted. Providers whose SDKs
   * don't expose a timeout option (Bedrock, Vertex AI, Cohere today)
   * ignore the value — the dashboard's fetch wrapper and Express
   * request timeout still bound the wall time end-to-end.
   */
  requestTimeoutMs?: number;
  /**
   * Optional streaming callback. When set, the provider opens its
   * SDK's streaming endpoint and invokes `onText` with each incremental
   * delta. The returned LLMResponse still resolves with the full
   * assembled text + usage at the end — callers that don't need
   * streaming can leave it unset and the provider returns a single
   * non-stream completion as before.
   *
   * Providers without streaming support (or that haven't been wired
   * yet) silently ignore this — the call falls back to the non-stream
   * code path and just never fires `onText`.
   */
  onText?: (delta: string, accumulated: string) => void;
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
  opencode_zen: [
    "big-pickle",
  ],
};
