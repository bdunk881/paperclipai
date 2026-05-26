/**
 * OpenRouter health watchdog (Phase 1 remainder, plan §"OpenRouter
 * health-check + watchdog job").
 *
 * OpenRouter's own auto-recharge (Stripe Issuing card on file with
 * "if balance < $X, top up to $Y") is the primary funding path. This
 * watchdog exists to catch the failure modes: card declined, OpenRouter
 * API hiccup, auto-recharge not yet fired during a burst. Every 15 min:
 *
 *   1. Read OpenRouter remaining balance via GET /api/v1/credits.
 *   2. Persist it onto every `source_kind='openrouter'` row.
 *   3. Recompute trailing-24h credits-mode wholesale spend (sum
 *      wholesale_cost_usd from the ledger where type='consumption').
 *   4. If balance < 1× trailing-24h spend, flip the row's status to
 *      `low_balance` so creditsRouter.pickKeySource skips it (callers
 *      get a friendly "service temporarily at capacity" error instead
 *      of a 5xx).
 *   5. If balance recovers above 3× trailing-24h spend AND the row is
 *      currently `low_balance`, flip back to `active` automatically.
 *
 * The watchdog never CHARGES OpenRouter — it only observes + flips
 * status. Topping up is OpenRouter's auto-recharge job. (See the
 * `stripeIssuing.ts` follow-up helper for setup.)
 */
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { setStatus, updatePrepaidBalance } from "./keySourceStore";

const OPENROUTER_BALANCE_URL = "https://openrouter.ai/api/v1/credits";

export interface OpenRouterCreditsResponse {
  data: {
    /** Total amount of credits ever deposited (USD). */
    total_credits: number;
    /** Amount spent to date (USD). */
    total_usage: number;
  };
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const LOW_BALANCE_DAYS = 1;
const HEALTHY_RECOVERY_DAYS = 3;
const TRAILING_WINDOW_HOURS = 24;

interface OpenRouterRow {
  id: string;
  status: string;
  key_ciphertext: string;
}

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "openrouterHealthJob requires DATABASE_URL outside development/test.",
  );
}

/**
 * Compute the trailing-24h wholesale spend across all credits-mode
 * consumption. We don't filter by source here because Phase 1 has only
 * the OpenRouter source; Phase 2 will add a `source_id` ledger column
 * if we need per-source breakdowns.
 */
async function getTrailingDailySpendUsd(): Promise<number> {
  if (!persistenceAvailable()) return 0;
  const result = await queryPostgres<{ wholesale_sum: string | null }>(
    `SELECT COALESCE(SUM(wholesale_cost_usd), 0)::text AS wholesale_sum
       FROM workspace_credit_ledger
      WHERE type = 'consumption'
        AND created_at > now() - ($1::text || ' hours')::interval`,
    [String(TRAILING_WINDOW_HOURS)],
  );
  return Number(result.rows[0]?.wholesale_sum ?? "0");
}

interface OpenRouterFetchResult {
  balanceUsd: number;
}

/**
 * Read OpenRouter's current remaining balance. Returns null on transient
 * errors so the watchdog can keep running — a single failed read should
 * not flip status; the next cycle will retry.
 */
async function readOpenRouterBalance(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterFetchResult | null> {
  try {
    const res = await fetchImpl(OPENROUTER_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(
        `[openrouterHealthJob] balance fetch returned HTTP ${res.status} — skipping cycle`,
      );
      return null;
    }
    const body = (await res.json()) as OpenRouterCreditsResponse;
    const balance = (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
    return { balanceUsd: balance };
  } catch (err) {
    console.warn(
      `[openrouterHealthJob] balance fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export interface HealthCheckResult {
  sourcesChecked: number;
  balanceUsd: number | null;
  trailing24hUsd: number;
  flippedToLowBalance: number;
  flippedToActive: number;
}

/**
 * Single watchdog cycle. Exposed so a test or admin endpoint can poke it
 * synchronously; the scheduled loop just calls this in a try/catch.
 */
export async function runOpenrouterHealthCheck(opts?: {
  /** Test hook — override fetch with a stub. */
  fetchImpl?: typeof fetch;
}): Promise<HealthCheckResult> {
  if (!persistenceAvailable()) {
    return {
      sourcesChecked: 0,
      balanceUsd: null,
      trailing24hUsd: 0,
      flippedToLowBalance: 0,
      flippedToActive: 0,
    };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const pool = getPostgresPool();
  const rowsRes = await pool.query<OpenRouterRow>(
    `SELECT id, status, key_ciphertext
       FROM platform_provider_keys
      WHERE source_kind = 'openrouter'
        AND status IN ('active','low_balance')`,
  );

  if (rowsRes.rowCount === 0) {
    return {
      sourcesChecked: 0,
      balanceUsd: null,
      trailing24hUsd: 0,
      flippedToLowBalance: 0,
      flippedToActive: 0,
    };
  }

  const trailing24hUsd = await getTrailingDailySpendUsd();
  const lowBalanceThreshold = trailing24hUsd * LOW_BALANCE_DAYS;
  const recoveryThreshold = trailing24hUsd * HEALTHY_RECOVERY_DAYS;

  let flippedToLowBalance = 0;
  let flippedToActive = 0;
  let lastObservedBalance: number | null = null;

  // The vault decryption happens via keySourceStore.pickKeySource normally
  // but that goes through the public selection logic. Here we read the
  // ciphertext directly because we need to address every row whether or
  // not it's currently active.
  const { connectorSecretVault } = await import(
    "../../integrations/shared/credentialRegistry"
  );

  for (const row of rowsRes.rows) {
    let apiKey: string;
    try {
      apiKey = connectorSecretVault.decrypt(row.key_ciphertext);
    } catch (err) {
      console.error(
        `[openrouterHealthJob] failed to decrypt key for source ${row.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    const reading = await readOpenRouterBalance(apiKey, fetchImpl);
    if (!reading) continue;

    lastObservedBalance = reading.balanceUsd;
    await updatePrepaidBalance(row.id, reading.balanceUsd);

    // Trailing spend is zero on day 0 (no consumption yet) — don't flip
    // a fresh source into low_balance just because there's no usage to
    // compare against.
    if (trailing24hUsd <= 0) continue;

    if (row.status === "active" && reading.balanceUsd < lowBalanceThreshold) {
      await setStatus(row.id, "low_balance");
      flippedToLowBalance += 1;
      console.warn(
        `[openrouterHealthJob] source ${row.id} balance $${reading.balanceUsd.toFixed(2)} < ` +
          `${LOW_BALANCE_DAYS}-day trailing spend $${lowBalanceThreshold.toFixed(2)} — flipped to low_balance`,
      );
    } else if (
      row.status === "low_balance"
      && reading.balanceUsd >= recoveryThreshold
    ) {
      await setStatus(row.id, "active");
      flippedToActive += 1;
      console.log(
        `[openrouterHealthJob] source ${row.id} balance recovered to $${reading.balanceUsd.toFixed(2)} ` +
          `(>= ${HEALTHY_RECOVERY_DAYS}-day target $${recoveryThreshold.toFixed(2)}) — flipped back to active`,
      );
    }
  }

  return {
    sourcesChecked: rowsRes.rowCount ?? 0,
    balanceUsd: lastObservedBalance,
    trailing24hUsd,
    flippedToLowBalance,
    flippedToActive,
  };
}

interface SchedulerHandle {
  stop: () => void;
}

/**
 * Start the recurring watchdog loop. Returns a handle the caller can use
 * to stop it (e.g. on graceful shutdown). Calling start twice without
 * stopping returns a new handle but does not duplicate timers — the
 * second start is treated as the canonical one, the first must be
 * stopped by the caller.
 */
export function startOpenrouterHealthJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts?.logger ?? console;

  if (!isPostgresPersistenceEnabled()) {
    logger.log(
      "[openrouterHealthJob] DATABASE_URL not configured — watchdog disabled",
    );
    return { stop: () => undefined };
  }

  const tick = (): void => {
    runOpenrouterHealthCheck()
      .then((result) => {
        if (result.sourcesChecked === 0) return;
        if (result.flippedToLowBalance > 0 || result.flippedToActive > 0) {
          logger.log(
            `[openrouterHealthJob] cycle complete: ${result.sourcesChecked} source(s), ` +
              `balance=$${result.balanceUsd?.toFixed(2) ?? "?"}, ` +
              `trailing24h=$${result.trailing24hUsd.toFixed(2)}, ` +
              `→low_balance=${result.flippedToLowBalance}, →active=${result.flippedToActive}`,
          );
        }
      })
      .catch((err) => {
        logger.error(
          `[openrouterHealthJob] cycle failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  };

  // Fire once immediately so first-boot doesn't wait 15 min for the
  // first balance read.
  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[openrouterHealthJob] watchdog started, interval=${intervalMs}ms`);

  return {
    stop: () => clearInterval(handle),
  };
}
