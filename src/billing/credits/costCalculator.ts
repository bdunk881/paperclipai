/**
 * Cost calculator — converts token counts into wholesale USD, retail
 * USD (with markup), and credits. The hot-path lives here so we have
 * one canonical place that knows the formulae. Integer credit math
 * throughout: the wallet holds bigint counts, never floats.
 */
import {
  isPostgresConfigured,
  queryPostgres,
} from "../../db/postgres";
import { CREDIT_USD_VALUE, ModelRate, getDefaultModelRate, getModelRate } from "./modelPricing";

export interface TokenCounts {
  promptTokens: number;
  completionTokens: number;
  /** Portion of promptTokens served from the provider's prompt cache. */
  cachedPromptTokens?: number;
  /** Anthropic-only: portion that wrote the cache on this turn. */
  cachedCreationTokens?: number;
}

export interface CostBreakdown {
  wholesaleUsd: number;
  retailUsd: number;
  markupMultiplier: number;
  credits: bigint;
  rate: ModelRate;
}

/**
 * Compute wholesale USD for a token bundle against a given rate. The
 * inputs are kept granular so we can attribute cost-sub-buckets in
 * the ledger row for analytics later.
 */
export function computeWholesaleUsd(rate: ModelRate, tokens: TokenCounts): number {
  const cached = tokens.cachedPromptTokens ?? 0;
  const cacheWrite = tokens.cachedCreationTokens ?? 0;
  const uncachedInput = Math.max(0, tokens.promptTokens - cached - cacheWrite);

  const inputUsd = (uncachedInput / 1_000_000) * rate.inputUsdPerMillion;
  const cachedInputUsd = rate.cachedInputUsdPerMillion != null
    ? (cached / 1_000_000) * rate.cachedInputUsdPerMillion
    : (cached / 1_000_000) * rate.inputUsdPerMillion;
  const cacheWriteUsd = rate.cacheWriteUsdPerMillion != null
    ? (cacheWrite / 1_000_000) * rate.cacheWriteUsdPerMillion
    : (cacheWrite / 1_000_000) * rate.inputUsdPerMillion;
  const outputUsd = (tokens.completionTokens / 1_000_000) * rate.outputUsdPerMillion;

  return inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd;
}

export function usdToCredits(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) return 0n;
  // Round UP so we never under-bill. Credits unit is $0.0001, so a USD
  // amount of 0.00015 → 2 credits, not 1.
  return BigInt(Math.ceil(usd / CREDIT_USD_VALUE));
}

export function applyMarkup(wholesaleUsd: number, markup: number): number {
  return wholesaleUsd * markup;
}

/**
 * Returns the workspace's `credits_markup_override` (per migration 072)
 * or null if unset / unavailable. Null means "use the model rate's
 * default markup" (typically 1.50× per the launch decision).
 *
 * Reads via the privileged pool connection — this is platform metadata
 * lookup, not workspace-isolated user content.
 */
export async function getWorkspaceMarkupOverride(
  workspaceId: string,
): Promise<number | null> {
  if (!isPostgresConfigured()) return null;
  const result = await queryPostgres<{ credits_markup_override: string | null }>(
    `SELECT credits_markup_override::text AS credits_markup_override
       FROM workspaces
      WHERE id = $1`,
    [workspaceId],
  );
  if (result.rowCount === 0) return null;
  const raw = result.rows[0].credits_markup_override;
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reserve-time worst-case estimate. The caller hasn't fired the LLM
 * call yet, so we don't have completionTokens — we assume the model
 * uses its full output budget. This deliberately overshoots; commit
 * time refunds the difference.
 *
 * `workspaceId` is optional — when present we honor a per-workspace
 * `credits_markup_override` (migration 072). Falls back to the rate's
 * default multiplier (uniform 1.50× at launch) when absent or unset.
 */
export async function estimateWorstCaseCredits(args: {
  provider: string;
  model: string;
  promptTokens: number;
  maxOutputTokens: number;
  workspaceId?: string;
}): Promise<CostBreakdown | null> {
  const rate = (await getModelRate(args.provider, args.model))
    ?? getDefaultModelRate(args.provider, args.model);
  if (!rate || !rate.enabled) {
    return null;
  }
  const override = args.workspaceId
    ? await getWorkspaceMarkupOverride(args.workspaceId)
    : null;
  const markup = override ?? rate.markupMultiplier;
  const wholesale = computeWholesaleUsd(rate, {
    promptTokens: args.promptTokens,
    completionTokens: args.maxOutputTokens,
  });
  const retail = applyMarkup(wholesale, markup);
  return {
    wholesaleUsd: wholesale,
    retailUsd: retail,
    markupMultiplier: markup,
    credits: usdToCredits(retail),
    rate,
  };
}

/**
 * Commit-time actual cost. The caller has the real usage from the LLM
 * response and uses this to compute the final ledger row. `workspaceId`
 * threading mirrors estimateWorstCaseCredits — same per-workspace
 * markup-override semantics.
 */
export async function actualCallCredits(args: {
  provider: string;
  model: string;
  usage: TokenCounts;
  workspaceId?: string;
}): Promise<CostBreakdown | null> {
  const rate = (await getModelRate(args.provider, args.model))
    ?? getDefaultModelRate(args.provider, args.model);
  if (!rate || !rate.enabled) {
    return null;
  }
  const override = args.workspaceId
    ? await getWorkspaceMarkupOverride(args.workspaceId)
    : null;
  const markup = override ?? rate.markupMultiplier;
  const wholesale = computeWholesaleUsd(rate, args.usage);
  const retail = applyMarkup(wholesale, markup);
  return {
    wholesaleUsd: wholesale,
    retailUsd: retail,
    markupMultiplier: markup,
    credits: usdToCredits(retail),
    rate,
  };
}
