/**
 * Hosted free model providers (PR B.1).
 *
 * AutoFlow's Explore tier needs a way to run workflows without the user
 * pasting their own LLM API key. This module defines the three free
 * tiers offered out of the box and exposes the env-var-backed credentials
 * the engine routes through when no workspace BYOK config exists.
 *
 * Tier 1 — Big Pickle (stealth model via OpenCode Zen)
 *   Free during their limited beta. Underlying model + provider are
 *   NOT disclosed by OpenCode. Prompts may be used to train the model
 *   (per OpenCode Zen's docs). User-facing disclosure of this trade-off
 *   lands with PR B.3.
 *
 * Tier 2 — Llama 3.1 8B (Groq)
 *   Fast, privacy-respecting (Groq does not train on customer data).
 *   Default tier for new Explore workspaces.
 *
 * Tier 3 — Llama 3.3 70B (Groq)
 *   Slower, capable, same privacy guarantees as Tier 2.
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
  /** UI grouping — Tier 1 is "trial / beta", Tier 2/3 are stable hosted. */
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
  {
    id: "groq_llama_31_8b",
    tier: 2,
    label: "Free Fast (Llama 3.1 8B)",
    description:
      "Llama 3.1 8B on Groq. Fast inference; Groq doesn't train on customer data.",
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    apiKeyEnvVar: "GROQ_API_KEY",
    warnings: [],
  },
  {
    id: "groq_llama_33_70b",
    tier: 3,
    label: "Free Smart (Llama 3.3 70B)",
    description:
      "Llama 3.3 70B on Groq. Slower, more capable; same privacy as Tier 2.",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    apiKeyEnvVar: "GROQ_API_KEY",
    warnings: [],
  },
];

/**
 * Default tier picked when no workspace preference is set.
 * Tier 2 (Groq 8B) wins over Tier 1 (Big Pickle) because Tier 1 trains
 * on prompts — opting users into that needs explicit consent (PR B.3),
 * not silent default routing.
 */
export const DEFAULT_HOSTED_FREE_PROVIDER_ID = "groq_llama_31_8b";

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
