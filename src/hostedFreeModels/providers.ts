/**
 * Hosted free model providers (PR B.1).
 *
 * AutoFlow's Explore tier needs a way to run workflows without the user
 * pasting their own LLM API key. This module defines the hosted free
 * model(s) offered out of the box and exposes the env-var-backed credentials
 * the engine routes through when no workspace BYOK config exists.
 *
 * The free model is OpenCode Zen (Big Pickle) — a stealth model whose
 * underlying provider OpenCode does not disclose, and which may use prompts
 * for training (per OpenCode Zen's docs; surfaced to users via `warnings`).
 * OpenCode Zen exposes multiple models and routes internally, so we don't
 * curate additional fast/smart tiers. (HEL-605 dropped the earlier Groq tiers.)
 *
 * Per-workspace daily token caps + the workspace-level tier preference
 * are PR B.2 / B.3 — this module just ships the static catalog + the
 * default-resolver the engine uses for the fallback path.
 */

import type {
  LLMProviderCredentials,
  ProviderName,
} from "../engine/llmProviders/types";
import type { DecryptedLLMConfig, LLMConfigPublic } from "../llmConfig/llmConfigStore";

export type HostedFreeTier = 1 | 2 | 3;

export interface HostedFreeProvider {
  /** Stable string id surfaced to the dashboard + selector. */
  id: string;
  /** UI grouping for the selection surface (currently a single beta tier). */
  tier: HostedFreeTier;
  /** Human-readable label. */
  label: string;
  /** One-line description for the UI. */
  description: string;
  /** Underlying provider (must be in PROVIDER_NAMES). */
  provider: ProviderName;
  /** Fixed model id — bypasses the engine's tier classifier. */
  modelId: string;
  /** Env var that holds the shared API key for this provider. */
  apiKeyEnvVar: string;
  /** UI-facing caveats (e.g. data training, beta status). */
  warnings: string[];
}

/**
 * Canonical catalog. Ordered by tier so callers can rely on
 * `HOSTED_FREE_PROVIDERS[0]` etc. being a stable identity.
 */
export const HOSTED_FREE_PROVIDERS: HostedFreeProvider[] = [
  {
    id: "opencode_zen_big_pickle",
    tier: 1,
    label: "AutoFlow Free Beta",
    description:
      "Stealth model via OpenCode Zen. Free during their limited beta.",
    provider: "opencode_zen",
    modelId: "big-pickle",
    apiKeyEnvVar: "OPENCODE_ZEN_API_KEY",
    warnings: [
      "Prompts may be used to train this model.",
      "Limited-time beta — could be removed at any time.",
    ],
  },
];

/**
 * The sole hosted free model. Groq was dropped (HEL-605) — OpenCode Zen
 * exposes multiple models and routes internally, so we don't curate Groq
 * tiers. NOTE: Big Pickle may use prompts for training (see its `warnings`,
 * surfaced at the model-selection UI); there is no non-training free model
 * today, so that caveat is inherent to the free tier until OpenCode Zen
 * exposes more model IDs.
 */
export const DEFAULT_HOSTED_FREE_PROVIDER_ID = "opencode_zen_big_pickle";

export function getHostedFreeProviderById(
  id: string,
): HostedFreeProvider | undefined {
  return HOSTED_FREE_PROVIDERS.find((p) => p.id === id);
}

/**
 * Resolves the API key for a hosted free provider from process.env.
 * Returns null when the env var isn't set, so the caller (engine
 * fallback in stepHandlers.ts) can decline to use the provider and
 * surface the original "no LLM provider configured" error to the user
 * instead of throwing a confusing 500.
 */
export function resolveHostedFreeApiKey(
  provider: HostedFreeProvider,
): string | null {
  const value = process.env[provider.apiKeyEnvVar];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Returns the default hosted free provider if its API key is configured,
 * otherwise null. The engine calls this before each LLM step to decide
 * whether the hosted-free fallback path is even available in this env.
 */
export function getDefaultHostedFreeProvider(): HostedFreeProvider | null {
  const def = getHostedFreeProviderById(DEFAULT_HOSTED_FREE_PROVIDER_ID);
  if (!def) return null;
  return resolveHostedFreeApiKey(def) ? def : null;
}

/**
 * Synthesize a DecryptedLLMConfig-shaped object so the engine's existing
 * stepHandlers.ts path (which calls getProvider({ provider, model,
 * apiKey, ... })) can use the hosted free fallback without any other
 * branching. Marked with a synthetic id so log lines + audit trails
 * make the source visible.
 */
export function buildResolvedFromHostedFree(
  provider: HostedFreeProvider,
  apiKey: string,
): DecryptedLLMConfig {
  const config: LLMConfigPublic = {
    id: `hosted-free:${provider.id}`,
    userId: "system",
    label: provider.label,
    provider: provider.provider,
    model: provider.modelId,
    credentialSummary: {},
    apiKeyMasked: undefined,
    providerOptions: undefined,
    isDefault: false,
    createdAt: new Date(0).toISOString(),
  };
  const credentials: LLMProviderCredentials = { apiKey };
  return { config, credentials, apiKey };
}
