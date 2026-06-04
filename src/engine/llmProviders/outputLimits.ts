/**
 * Per-provider ceilings on a single completion's output-token budget, plus a
 * clamp helper. (HEL-501)
 *
 * Callers that need a large response (e.g. the team-assembly hiring plan, which
 * emits each agent's full spec twice and runs on reasoning models that spend
 * part of the budget "thinking") want to request a generous `maxOutputTokens`.
 * But the budget can't be raised blindly: several providers HARD-ERROR when
 * `max_tokens` exceeds the model's cap (OpenAI: "max_tokens is too large";
 * Anthropic requires `max_tokens <= model max`) rather than clamping
 * server-side. Gemini, by contrast, accepts far more (2.5-pro supports 65536).
 *
 * So a desired budget is clamped to a conservative per-provider ceiling — the
 * smallest common output cap across that provider's current models. Raising a
 * specific high-cap model further is a follow-up, not a blanket bump; the goal
 * here is "ask for more where it's safe, never request more than the API
 * accepts."
 */

import type { ProviderName } from "./types";

/**
 * Conservative max output tokens per provider. Keys mirror
 * `PROVIDER_STREAM_CAPABILITIES` (one entry per supported provider) so a newly
 * added provider fails the build until it declares a cap here.
 */
export const PROVIDER_MAX_OUTPUT_TOKENS: Record<ProviderName, number> = {
  // Gemini 2.5-pro/flash accept up to 65536 output tokens.
  gemini: 65536,
  "vertex-ai": 65536,
  // OpenAI current models cap completion output around 16k.
  openai: 16384,
  xai: 16384,
  // Anthropic requires max_tokens <= model max; 8192 is the safe floor across
  // Claude 3.5/3.7 (newer models allow more via beta headers — not assumed).
  anthropic: 8192,
  mistral: 8192,
  bedrock: 8192,
  groq: 8192,
  fireworks: 8192,
  together: 8192,
  ollama: 8192,
  localai: 8192,
  perplexity: 8192,
  deepseek: 8192,
  opencode_zen: 8192,
  openrouter: 8192,
  // Cohere Command-R output caps lower.
  cohere: 4096,
};

/** Safe fallback when a provider somehow isn't in the table. */
const FALLBACK_MAX_OUTPUT_TOKENS = 8192;

/**
 * Clamp a *desired* per-call output-token budget to what `provider` will
 * accept. A non-positive / non-finite desired value falls back to the
 * provider's ceiling. Always returns a positive integer.
 */
export function clampMaxOutputTokens(provider: ProviderName, desired: number): number {
  const cap = PROVIDER_MAX_OUTPUT_TOKENS[provider] ?? FALLBACK_MAX_OUTPUT_TOKENS;
  if (!Number.isFinite(desired) || desired <= 0) return cap;
  return Math.min(Math.floor(desired), cap);
}
