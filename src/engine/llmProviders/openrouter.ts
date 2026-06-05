/**
 * OpenRouter LLM adapter — Phase 1 backbone of the hosted-credits routing
 * topology. OpenRouter exposes an OpenAI-compatible chat-completions
 * endpoint at https://openrouter.ai/api/v1; we plug into it via the same
 * `createOpenAICompatibleProvider` shim that handles Groq, DeepSeek,
 * Fireworks, etc.
 *
 * The wrinkle vs. those providers is the model-ID format: OpenRouter
 * addresses models as `vendor/model-slug` (e.g. `anthropic/claude-sonnet-4-6`).
 * Our internal LLMProviderConfig still names the provider+model
 * separately ({ provider: "anthropic", model: "claude-sonnet-4-6" }),
 * so we translate on the way out.
 *
 * Why a separate adapter (vs. just adding "openrouter" to compatProviders):
 *   - The model-ID translation is non-trivial — OpenRouter has its own
 *     vendor namespacing and not every vendor slug matches the model name
 *     verbatim (e.g. OpenAI `gpt-5.5` → OpenRouter `openai/gpt-5.5`).
 *   - We want a single chokepoint that the credits router can swap to
 *     when the platform's openrouter key source is selected, without
 *     touching every BYOK call site.
 *
 * Set OPENROUTER_API_KEY (or pass the key in config.apiKey) before use.
 */
import { createOpenAICompatibleProvider } from "./openaiCompatible";
import type { LLMProvider, LLMProviderConfig } from "./types";

/**
 * Translate our internal { provider, model } into the OpenRouter model
 * slug. OpenRouter's catalog is at https://openrouter.ai/models — we
 * cover the launch tier-routing targets here; unknown combinations
 * fall through to "provider/model" which works for many entries and
 * surfaces a clear OpenRouter 404 for the rest.
 */
export function toOpenRouterModelId(provider: string, model: string): string {
  const key = `${provider}::${model}`;
  return OPENROUTER_MODEL_MAP[key] ?? `${provider}/${model}`;
}

const OPENROUTER_MODEL_MAP: Record<string, string> = {
  // Anthropic
  "anthropic::claude-opus-4-8":           "anthropic/claude-opus-4.8",
  "anthropic::claude-opus-4-7":           "anthropic/claude-opus-4.7",
  "anthropic::claude-sonnet-4-6":         "anthropic/claude-sonnet-4.6",
  "anthropic::claude-haiku-4-5":          "anthropic/claude-haiku-4.5",
  "anthropic::claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  // OpenAI
  "openai::gpt-5.5":      "openai/gpt-5.5",
  "openai::gpt-5.4":      "openai/gpt-5.4",
  "openai::gpt-5.4-mini": "openai/gpt-5.4-mini",
  "openai::gpt-5.4-nano": "openai/gpt-5.4-nano",
  // Gemini
  "gemini::gemini-3.5-flash":      "google/gemini-3.5-flash",
  "gemini::gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite",
  "gemini::gemini-2.5-pro":        "google/gemini-2.5-pro",
  // DeepSeek
  "deepseek::deepseek-v4-pro":   "deepseek/deepseek-v4-pro",
  "deepseek::deepseek-v4-flash": "deepseek/deepseek-v4-flash",
  // Groq (OpenRouter routes Groq-hosted Llamas via meta-llama slug)
  "groq::llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct",
  "groq::llama-3.1-8b-instant":    "meta-llama/llama-3.1-8b-instruct",
};

/**
 * Create the OpenRouter provider adapter. The caller passes
 * { provider: "openrouter", model: "<our-internal-model-id>",
 *   apiKey: "<openrouter-key>",
 *   options: { endpoint: "...", origin?: "...", appTitle?: "..." } }
 *
 * `model` should be the AutoFlow internal model name we want to route
 * to (e.g. `claude-sonnet-4-6`). The downstream provider is encoded in
 * the apiKey + config.options.routedProvider field, which we infer
 * either from config.options.routedProvider or via a default lookup.
 */
export function createOpenRouterProvider(config: LLMProviderConfig): LLMProvider {
  return createOpenAICompatibleProvider(config, {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    resolveModel: (cfg) => {
      const routedProvider = (cfg.options as { routedProvider?: string } | undefined)?.routedProvider;
      if (routedProvider) {
        return toOpenRouterModelId(routedProvider, cfg.model);
      }
      // If the caller already supplied a vendor-prefixed slug
      // (e.g. "anthropic/claude-sonnet-4.6"), pass through as-is.
      if (cfg.model.includes("/")) return cfg.model;
      // Last-resort fallback — let OpenRouter 404 on an unrecognized
      // model rather than guessing a vendor.
      return cfg.model;
    },
  });
}
