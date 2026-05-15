/**
 * Cost helper for hiring-plan generation calls (HEL-74).
 *
 * The LLM provider response carries token counts (`usage.promptTokens` /
 * `completionTokens`); deriving USD cost requires a per-provider+model
 * rate table. This module owns that table and exposes a single helper
 * the missions route uses to compute `cost_cents` for `step_results`.
 *
 * Rate sources (USD per 1K tokens, prompt + completion):
 *   - Anthropic: https://www.anthropic.com/pricing#anthropic-api (2026 list)
 *   - OpenAI:    https://openai.com/api/pricing (2026 list)
 *
 * If a model isn't in the table, the helper returns 0 — better to log
 * zero than to fabricate a number. The Activity feed shows the row
 * regardless so a missing rate surfaces visibly.
 *
 * This file is intentionally provider-name + model-name keyed (not a
 * tier abstraction) so adding a new model is a single-line table edit.
 */

import type { ProviderName } from "../engine/llmProviders/types";

interface RateEntry {
  /** USD per 1K prompt tokens */
  promptPer1k: number;
  /** USD per 1K completion tokens */
  completionPer1k: number;
}

/**
 * Per-model rates. Keys are normalized to lower-case to make lookups
 * tolerant to model name casing differences. Missing models fall back
 * to a per-tier conservative default — see `tierFallback` below.
 */
const RATES: Partial<Record<ProviderName, Record<string, RateEntry>>> = {
  openai: {
    "gpt-4o": { promptPer1k: 0.0025, completionPer1k: 0.01 },
    "gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
    "gpt-4-turbo": { promptPer1k: 0.01, completionPer1k: 0.03 },
    "gpt-3.5-turbo": { promptPer1k: 0.0005, completionPer1k: 0.0015 },
  },
  anthropic: {
    // Claude 3.5 family per the 2026 list. Newer claude-sonnet-4-x models
    // share the Sonnet rate point until/unless Anthropic publishes a
    // distinct tier.
    "claude-3-5-sonnet": { promptPer1k: 0.003, completionPer1k: 0.015 },
    "claude-3-5-haiku": { promptPer1k: 0.0008, completionPer1k: 0.004 },
    "claude-3-opus": { promptPer1k: 0.015, completionPer1k: 0.075 },
    "claude-sonnet-4-6": { promptPer1k: 0.003, completionPer1k: 0.015 },
  },
};

/**
 * Conservative fallback rates by "tier feel" of the model name. Used when
 * the exact model isn't listed. Errs on the side of charging slightly
 * more than the real rate so we don't undershoot budgets.
 */
function tierFallback(model: string): RateEntry {
  const lc = model.toLowerCase();
  if (lc.includes("opus") || lc.includes("gpt-4-turbo")) {
    return { promptPer1k: 0.015, completionPer1k: 0.075 };
  }
  if (lc.includes("sonnet") || lc.includes("gpt-4o") || lc.includes("gpt-4")) {
    return { promptPer1k: 0.003, completionPer1k: 0.015 };
  }
  if (lc.includes("haiku") || lc.includes("mini") || lc.includes("3.5")) {
    return { promptPer1k: 0.0008, completionPer1k: 0.004 };
  }
  // Truly unknown model: zero so the row still writes (HEL-74 wants a
  // visible step_results entry per generation) but doesn't anchor budget
  // calculations on a guess.
  return { promptPer1k: 0, completionPer1k: 0 };
}

export interface ComputeCostInput {
  provider: ProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ComputeCostResult {
  costCents: number;
  /** What the helper used for the lookup. Always returned so callers can log it. */
  rate: RateEntry;
  /** True when the exact provider+model was in the table; false when fallback ran. */
  matched: boolean;
}

export function computeHiringPlanCostCents(input: ComputeCostInput): ComputeCostResult {
  const tableForProvider = RATES[input.provider] ?? {};
  const exact = tableForProvider[input.model.toLowerCase()];
  const rate = exact ?? tierFallback(input.model);
  const matched = Boolean(exact);

  const promptCost = (input.promptTokens / 1000) * rate.promptPer1k;
  const completionCost = (input.completionTokens / 1000) * rate.completionPer1k;
  // Round to the nearest cent; floor would drop sub-cent calls.
  const costCents = Math.round((promptCost + completionCost) * 100);

  return { costCents, rate, matched };
}
