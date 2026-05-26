/**
 * Wholesale rate card for credits-mode inference.
 *
 * The DB-side rate card lives in `hosted_model_pricing` (migration 070).
 * This file mirrors the launch defaults so callers can compute costs
 * without a DB round-trip on the hot path. The DB row is the
 * source-of-truth for ops-managed price changes; this file is what we
 * fall back to when the DB hasn't been seeded yet (CI, local in-memory
 * dev) and is the seed source for the migration.
 *
 * All rates are USD per 1,000,000 tokens. Markup is uniform 1.50× at
 * launch (per the locked decision in the plan). Credits unit: 1 credit
 * = $0.0001 of marked-up cost, so 10,000 credits = $1.00.
 */
import { isPostgresConfigured, queryPostgres } from "../../db/postgres";

export const CREDIT_USD_VALUE = 0.0001;

export interface ModelRate {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  outputUsdPerMillion: number;
  markupMultiplier: number;
  enabled: boolean;
}

/**
 * Hardcoded launch rate card. Mirrors the seed in migration 070. When
 * the DB seed wins (it has higher precedence), this is the fallback.
 */
export const DEFAULT_MODEL_RATES: readonly ModelRate[] = [
  { provider: "anthropic", model: "claude-opus-4-7",           inputUsdPerMillion: 5.00, cachedInputUsdPerMillion: 0.50, cacheWriteUsdPerMillion: 6.25, outputUsdPerMillion: 25.00, markupMultiplier: 1.50, enabled: true },
  { provider: "anthropic", model: "claude-sonnet-4-6",         inputUsdPerMillion: 3.00, cachedInputUsdPerMillion: 0.30, cacheWriteUsdPerMillion: 3.75, outputUsdPerMillion: 15.00, markupMultiplier: 1.50, enabled: true },
  { provider: "anthropic", model: "claude-haiku-4-5",          inputUsdPerMillion: 1.00, cachedInputUsdPerMillion: 0.10, cacheWriteUsdPerMillion: 1.25, outputUsdPerMillion:  5.00, markupMultiplier: 1.50, enabled: true },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", inputUsdPerMillion: 1.00, cachedInputUsdPerMillion: 0.10, cacheWriteUsdPerMillion: 1.25, outputUsdPerMillion:  5.00, markupMultiplier: 1.50, enabled: true },
  { provider: "openai",    model: "gpt-5.5",                   inputUsdPerMillion: 5.00, cachedInputUsdPerMillion: 2.50, outputUsdPerMillion: 30.00, markupMultiplier: 1.50, enabled: true },
  { provider: "openai",    model: "gpt-5.4",                   inputUsdPerMillion: 2.50, cachedInputUsdPerMillion: 1.25, outputUsdPerMillion: 15.00, markupMultiplier: 1.50, enabled: true },
  { provider: "openai",    model: "gpt-5.4-mini",              inputUsdPerMillion: 0.50, cachedInputUsdPerMillion: 0.25, outputUsdPerMillion:  2.00, markupMultiplier: 1.50, enabled: true },
  { provider: "openai",    model: "gpt-5.4-nano",              inputUsdPerMillion: 0.20, cachedInputUsdPerMillion: 0.10, outputUsdPerMillion:  0.80, markupMultiplier: 1.50, enabled: true },
  { provider: "gemini",    model: "gemini-3.5-flash",          inputUsdPerMillion: 1.50, cachedInputUsdPerMillion: 0.15, outputUsdPerMillion:  9.00, markupMultiplier: 1.50, enabled: true },
  { provider: "gemini",    model: "gemini-3.1-flash-lite",     inputUsdPerMillion: 0.25, cachedInputUsdPerMillion: 0.05, outputUsdPerMillion:  1.00, markupMultiplier: 1.50, enabled: true },
  { provider: "gemini",    model: "gemini-2.5-pro",            inputUsdPerMillion: 1.25, outputUsdPerMillion: 10.00, markupMultiplier: 1.50, enabled: true },
  { provider: "deepseek",  model: "deepseek-v4-pro",           inputUsdPerMillion: 0.435, cachedInputUsdPerMillion: 0.0036, outputUsdPerMillion: 0.87, markupMultiplier: 1.50, enabled: true },
  { provider: "deepseek",  model: "deepseek-v4-flash",         inputUsdPerMillion: 0.14,  cachedInputUsdPerMillion: 0.0028, outputUsdPerMillion: 0.28, markupMultiplier: 1.50, enabled: true },
  { provider: "groq",      model: "llama-3.3-70b-versatile",   inputUsdPerMillion: 0.59, outputUsdPerMillion: 0.79, markupMultiplier: 1.50, enabled: true },
  { provider: "groq",      model: "llama-3.1-8b-instant",      inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.08, markupMultiplier: 1.50, enabled: true },
];

const inMemoryCache = new Map<string, ModelRate>();
for (const rate of DEFAULT_MODEL_RATES) {
  inMemoryCache.set(rateKey(rate.provider, rate.model), rate);
}

function rateKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

/**
 * Returns the active rate for a (provider, model) pair. Reads from
 * `hosted_model_pricing` when Postgres is configured; falls back to the
 * code-side defaults otherwise. The latest non-superseded row wins.
 */
export async function getModelRate(
  provider: string,
  model: string,
): Promise<ModelRate | null> {
  if (isPostgresConfigured()) {
    const result = await queryPostgres<{
      input_usd_per_million: string;
      cached_input_usd_per_million: string | null;
      cache_write_usd_per_million: string | null;
      output_usd_per_million: string;
      markup_multiplier: string;
      enabled: boolean;
    }>(
      `SELECT input_usd_per_million, cached_input_usd_per_million,
              cache_write_usd_per_million, output_usd_per_million,
              markup_multiplier, enabled
       FROM hosted_model_pricing
       WHERE provider = $1 AND model = $2 AND superseded_at IS NULL
       ORDER BY effective_at DESC
       LIMIT 1`,
      [provider, model],
    );
    if (result.rowCount && result.rows[0]) {
      const row = result.rows[0];
      return {
        provider,
        model,
        inputUsdPerMillion: Number(row.input_usd_per_million),
        cachedInputUsdPerMillion: row.cached_input_usd_per_million != null
          ? Number(row.cached_input_usd_per_million)
          : undefined,
        cacheWriteUsdPerMillion: row.cache_write_usd_per_million != null
          ? Number(row.cache_write_usd_per_million)
          : undefined,
        outputUsdPerMillion: Number(row.output_usd_per_million),
        markupMultiplier: Number(row.markup_multiplier),
        enabled: row.enabled,
      };
    }
  }

  return inMemoryCache.get(rateKey(provider, model)) ?? null;
}

/**
 * Synchronous default lookup — code-side rate card only. Used by the
 * worst-case-estimation path inside reserveForLlmCall when we don't
 * want a DB round-trip in the hot path. Returns null for unknown
 * (provider, model).
 */
export function getDefaultModelRate(provider: string, model: string): ModelRate | null {
  return inMemoryCache.get(rateKey(provider, model)) ?? null;
}
