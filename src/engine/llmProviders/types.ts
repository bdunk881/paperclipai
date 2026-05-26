/**
 * Shared types for the LLM provider adapter layer.
 */

import type { AgentTraceCallback } from "../agentTrace/types";

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
  // OpenAI-compatible multi-vendor gateway. Used as the Phase 1 backbone
  // for hosted-credits routing — see src/billing/credits/creditsRouter.ts.
  // Single prepaid balance fronts every underlying provider.
  "openrouter",
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
   * Optional live trace callback. Providers emit canonical
   * `AgentTraceEvent` values (assistant deltas, tool calls, reasoning).
   * Preferred over `onText` for agent turns.
   */
  onTrace?: AgentTraceCallback;
  /**
   * @deprecated Use `onTrace` — mapped from `assistant.delta` events.
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
  /**
   * @deprecated The agentic tool-loop now lives in
   * `src/agents/runtime/fallbackAgentBackend.ts` (and the SDK backends).
   * Passing `tools` to `getProvider(...)` throws at runtime — route
   * agent runs through `runAgent()` instead. Field kept on the type
   * temporarily so external schemas / serialized configs that still
   * include it don't blow up at compile time; remove once HEL-82.x is
   * archived.
   */
  tools?: AgentTool[];
  /** @deprecated See `tools` above. */
  maxToolIterations?: number;
  /**
   * Optional system prompt. When set, Anthropic receives this in its
   * dedicated `system` field instead of having it concatenated into the
   * user prompt — which is the prerequisite for prompt caching.
   *
   * Callers that don't set this stay on the legacy "system prompt
   * inlined into user message" behaviour (no caching, no separate
   * system field).
   */
  systemPrompt?: string;
  /**
   * HEL-145: When true AND `systemPrompt` is set, the Anthropic adapter
   * tags the system block with `cache_control: { type: 'ephemeral' }`
   * so Anthropic caches the prefix for 5 minutes. Tool definitions are
   * cached alongside the system block when both are present (Anthropic
   * caches everything up to and including the cache breakpoint).
   *
   * No-op for providers without explicit cache controls (OpenAI caches
   * automatically; others ignore the flag).
   *
   * Expected ~50–80% input-token reduction on the second-and-later call
   * within the 5-minute TTL window. See `docs/audit/2026-05-18-llm-token-audit.md`.
   */
  cacheSystemPrompt?: boolean;
  /**
   * HEL-147: Per-call cap on the model's output tokens. Defaults to
   * 4096 when omitted — same as the legacy hardcoded value.
   *
   * Why bother when billing is metered on actual output not the cap?
   * Because `max_tokens` affects model behavior: a model given 4096
   * tokens of budget for a 50-token answer often rambles to ~500
   * tokens of unnecessary preamble. Tight caps force tight answers.
   *
   * Suggested caps per call type:
   *   - status-pill self-check     →  200
   *   - single-enum classification →   50
   *   - triage decision (small JSON) → 300
   *   - paragraph generation       →  800
   *   - team-plan JSON             → 3000
   *   - general agent step (varies)→ 4096 (default)
   */
  maxOutputTokens?: number;
}

/**
 * A tool the model can call during an agentic turn. The provider
 * loop translates the model's tool_use block into a call against
 * `handler(input)` and feeds the JSON-serialized result back as the
 * next message.
 *
 * `inputSchema` is a JSON Schema describing the tool's input. Most
 * providers want the same shape (Anthropic, OpenAI, Mistral, Gemini
 * all accept a JSON-Schema-ish object); the provider wrapper massages
 * shape differences.
 */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Invoked with the model's tool_use input. The returned value is
   * JSON-stringified and returned to the model as the tool_result.
   * Throw to surface an error to the model — the loop continues so
   * the model can try a different approach.
   */
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface LLMResponse {
  text: string;
  usage?: {
    /**
     * TOTAL input tokens for the request — uncached + cached + (for
     * Anthropic) cache-write tokens.
     *
     * HEL-145 contract (revised after Codex review on PR #898):
     *   - Anthropic returns `input_tokens` (uncached portion only) plus
     *     separate `cache_read_input_tokens` / `cache_creation_input_tokens`
     *     buckets. We sum the three into `promptTokens` so legacy
     *     consumers that only read this field get the same total they
     *     would have seen pre-caching (no double-counting, no
     *     undercounting).
     *   - OpenAI returns `prompt_tokens` already including the cached
     *     portion; we forward that total unchanged.
     *
     * Legacy callers (cost loggers, hosted-free token accounting, the
     * activity dashboard) keep reading `promptTokens` for total usage.
     * Cache-aware cost-attribution can compute discounted billing as:
     *
     *   const standardRateTokens =
     *     promptTokens
     *     - (cachedPromptTokens ?? 0)
     *     - (cachedCreationTokens ?? 0);
     *   const cost =
     *     standardRateTokens * standardInputRate +
     *     (cachedPromptTokens ?? 0) * cachedReadRate +
     *     (cachedCreationTokens ?? 0) * cacheWriteRate +
     *     completionTokens * outputRate;
     *
     * The cached* fields are informational sub-buckets; do NOT add
     * them to promptTokens when totaling usage.
     */
    promptTokens: number;
    completionTokens: number;
    /**
     * HEL-145: Portion of `promptTokens` that was served from the
     * provider's prompt cache at a reduced rate.
     *   - Anthropic: `cache_read_input_tokens` (billed at ~10% of
     *     full input cost).
     *   - OpenAI: `prompt_tokens_details.cached_tokens` (billed at
     *     50% of full input cost for the supported models).
     *
     * Always satisfies `cachedPromptTokens <= promptTokens`. Undefined
     * when the provider didn't report cache activity or doesn't expose
     * this metric.
     */
    cachedPromptTokens?: number;
    /**
     * HEL-145: Anthropic-only. Portion of `promptTokens` that was used
     * to *write* the cache on this request (cache miss / first call
     * within TTL). Billed at ~125% of full input cost — the surcharge
     * that pays for cache storage. Subsequent requests within the
     * 5-min TTL surface those same tokens as `cachedPromptTokens`
     * instead.
     *
     * Always satisfies `cachedCreationTokens <= promptTokens`.
     * Undefined for OpenAI (no per-request cache-write bucket — the
     * cache is opportunistic) and for providers without explicit
     * cache controls.
     */
    cachedCreationTokens?: number;
  };
}

/** Callable returned by getProvider — takes a prompt and returns an LLMResponse */
export type LLMProvider = (prompt: string) => Promise<LLMResponse>;

/**
 * Available models per provider — used by frontend dropdowns. Refreshed
 * 2026-05-23 to the latest production-stable model IDs for each provider's
 * public API. First entry of each list is treated as the default in the
 * dashboard connect form.
 *
 * Notes on selection:
 *   - OpenAI: GPT-5.5 is the current frontier; GPT-5.4 family is the
 *     production workhorse; o3 / o4-mini cover reasoning workloads; the
 *     older 5 / 5-mini / 5-nano family stays in the list as cheaper
 *     alternatives.
 *   - Anthropic: Opus 4.7 is the current top model; Sonnet 4.6 and Haiku 4.5
 *     remain the working tier (per Anthropic deprecations table 2026-05).
 *   - Gemini: 3.5 Flash is GA (2026-05-19), 3.1 Flash-Lite is GA (2026-05-07),
 *     3.1 Pro is still preview, so 2.5 Pro stays as the recommended large.
 *   - Mistral: Large 3 / Medium 3.5 / Small 4 family, accessed via -latest
 *     aliases per Mistral's docs.
 *   - Bedrock: stable Nova family (Premier / Pro / Lite / Micro). Nova 2
 *     Lite + Nova 2 Pro Preview are GA in Bedrock but the exact model IDs
 *     vary by region, so we keep the v1 lineup here.
 *   - Vertex AI: stable Gemini 2.5 + Claude 4.x IDs.
 *   - Groq: Llama 4 Maverick/Scout day-zero models plus the GPT-OSS family.
 *   - Cohere: Command A+ (2026-05) is the new MoE flagship.
 *   - Perplexity: legacy sonar-reasoning was retired 2025-12, replaced by
 *     sonar-reasoning-pro; sonar-deep-research is the new long-form mode.
 *   - xAI: Grok 4.3 redirects everything older (post 2026-05-15 retirement);
 *     grok-build-0.1 is the agentic-coding replacement for grok-code-fast-1.
 *   - DeepSeek: V4 Pro / Flash (1M context) replace V3.x. The legacy
 *     deepseek-chat / deepseek-reasoner names retire 2026-07-24.
 */
export const PROVIDER_MODELS: Record<ProviderName, string[]> = {
  openai: [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "o3",
    "o4-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
  ],
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-6",
  ],
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "codestral-latest",
  ],
  bedrock: [
    "amazon.nova-premier-v1:0",
    "amazon.nova-pro-v1:0",
    "amazon.nova-lite-v1:0",
    "amazon.nova-micro-v1:0",
  ],
  "vertex-ai": [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "claude-sonnet-4-6",
  ],
  groq: [
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ],
  fireworks: [
    "accounts/fireworks/models/llama4-maverick-instruct-basic",
    "accounts/fireworks/models/llama4-scout-instruct-basic",
    "accounts/fireworks/models/llama-v3p3-70b-instruct",
    "accounts/fireworks/models/deepseek-r1",
    "accounts/fireworks/models/deepseek-v3",
  ],
  together: [
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-V3",
    "deepseek-ai/DeepSeek-R1",
  ],
  ollama: [
    "llama3.3:70b",
    "llama3.2",
    "deepseek-r1:14b",
    "qwen2.5:14b",
  ],
  localai: [
    "llama-3.3-70b-instruct",
    "llama-3.1-8b-instruct",
    "llama-3.2-3b-instruct",
  ],
  cohere: [
    "command-a-plus-05-2026",
    "command-a-reasoning-08-2025",
    "command-a-03-2025",
    "command-r-plus-08-2024",
  ],
  perplexity: [
    "sonar-pro",
    "sonar-reasoning-pro",
    "sonar-deep-research",
    "sonar",
  ],
  xai: [
    "grok-4.3",
    "grok-4.3-latest",
    "grok-build-0.1",
  ],
  deepseek: [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-chat",
    "deepseek-reasoner",
  ],
  opencode_zen: [
    "big-pickle",
  ],
  // Multi-vendor gateway — model IDs use OpenRouter's
  // `vendor/model-slug` convention. The credits router translates from
  // our internal { provider, model } pairs at call time.
  openrouter: [
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5.5",
    "openai/gpt-5.4",
    "google/gemini-3.5-flash",
    "deepseek/deepseek-v4-pro",
    "meta-llama/llama-3.3-70b-instruct",
  ],
};
