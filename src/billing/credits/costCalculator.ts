/**
 * Cost calculator — converts token counts into wholesale USD, retail
 * USD (with markup), and credits. The hot-path lives here so we have
 * one canonical place that knows the formulae. Integer credit math
 * throughout: the wallet holds bigint counts, never floats.
 */
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
 * Reserve-time worst-case estimate. The caller hasn't fired the LLM
 * call yet, so we don't have completionTokens — we assume the model
 * uses its full output budget. This deliberately overshoots; commit
 * time refunds the difference.
 */
export async function estimateWorstCaseCredits(args: {
  provider: string;
  model: string;
  promptTokens: number;
  maxOutputTokens: number;
}): Promise<CostBreakdown | null> {
  const rate = (await getModelRate(args.provider, args.model))
    ?? getDefaultModelRate(args.provider, args.model);
  if (!rate || !rate.enabled) {
    return null;
  }
  const wholesale = computeWholesaleUsd(rate, {
    promptTokens: args.promptTokens,
    completionTokens: args.maxOutputTokens,
  });
  const retail = applyMarkup(wholesale, rate.markupMultiplier);
  return {
    wholesaleUsd: wholesale,
    retailUsd: retail,
    markupMultiplier: rate.markupMultiplier,
    credits: usdToCredits(retail),
    rate,
  };
}

/**
 * Commit-time actual cost. The caller has the real usage from the LLM
 * response and uses this to compute the final ledger row.
 */
export async function actualCallCredits(args: {
  provider: string;
  model: string;
  usage: TokenCounts;
}): Promise<CostBreakdown | null> {
  const rate = (await getModelRate(args.provider, args.model))
    ?? getDefaultModelRate(args.provider, args.model);
  if (!rate || !rate.enabled) {
    return null;
  }
  const wholesale = computeWholesaleUsd(rate, args.usage);
  const retail = applyMarkup(wholesale, rate.markupMultiplier);
  return {
    wholesaleUsd: wholesale,
    retailUsd: retail,
    markupMultiplier: rate.markupMultiplier,
    credits: usdToCredits(retail),
    rate,
  };
}
