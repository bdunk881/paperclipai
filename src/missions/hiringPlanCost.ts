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
    "gpt-5.5": { promptPer1k: 0.005, completionPer1k: 0.03 },
    "gpt-5.5-pro": { promptPer1k: 0.03, completionPer1k: 0.18 },
    "gpt-5.4": { promptPer1k: 0.0025, completionPer1k: 0.015 },
    "gpt-5.4-mini": { promptPer1k: 0.00075, completionPer1k: 0.0045 },
    "gpt-5.4-nano": { promptPer1k: 0.0002, completionPer1k: 0.00125 },
  },
  anthropic: {
    "claude-haiku-4-5-20251001": { promptPer1k: 0.001, completionPer1k: 0.005 },
    "claude-sonnet-4-6": { promptPer1k: 0.003, completionPer1k: 0.015 },
    "claude-opus-4-7": { promptPer1k: 0.005, completionPer1k: 0.025 },
  },
};

/**
 * Conservative fallback rates by "tier feel" of the model name. Used when
 * the exact model isn't listed. Errs on the side of charging slightly
 * more than the real rate so we don't undershoot budgets.
 */
function tierFallback(model: string): RateEntry {
  const lc = model.toLowerCase();
  if (lc.includes("gpt-5.5-pro")) {
    return { promptPer1k: 0.03, completionPer1k: 0.18 };
  }
  if (lc.includes("opus")) {
    return { promptPer1k: 0.005, completionPer1k: 0.025 };
  }
  if (lc.includes("gpt-5.5")) {
    return { promptPer1k: 0.005, completionPer1k: 0.03 };
  }
  if (lc.includes("sonnet") || lc.includes("gpt-5.4") || lc.includes("gpt-5")) {
    return { promptPer1k: 0.003, completionPer1k: 0.015 };
  }
  if (lc.includes("haiku") || lc.includes("mini") || lc.includes("nano")) {
    return { promptPer1k: 0.001, completionPer1k: 0.005 };
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
