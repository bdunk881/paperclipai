/**
 * Source-balance health watchdog (HEL-601) — generalized from the original
 * OpenRouter-only watchdog.
 *
 * Phase 1 shipped an OpenRouter-only job that READ `GET /api/v1/credits`,
 * persisted the balance, and flipped the row `active ↔ low_balance` vs the
 * trailing-24h credits-mode spend. HEL-601 generalizes that into a factory
 * (`runSourceHealthCheck`) parameterized by:
 *
 *   - selectRows()       which `platform_provider_keys` rows to check (already
 *                        decrypted, so the loop + decision logic are testable)
 *   - readBalance(key)   the remaining-balance signal (USD), null = skip
 *   - trailingSpendUsd() what to compare against (global for OpenRouter,
 *                        per-provider for direct)
 *   - onUnderfund()      fired when a row flips to low_balance (alert hook)
 *
 * The OpenRouter wrapper (`runOpenrouterHealthCheck` / `startOpenrouterHealthJob`)
 * keeps its exact prior behaviour + result shape; `openrouterHealthJob.ts`
 * re-exports them so existing imports are unchanged.
 *
 * **Inversion for direct rows (the point of HEL-601):** the watchdog is no
 * longer a passive observer. Anthropic + OpenAI expose no reliable public
 * remaining-balance endpoint, so the funding signal we watch is the shared
 * Stripe **Issuing balance** that funds both cards. When it can't cover a
 * provider's trailing spend we flip that provider's direct row to `low_balance`
 * (so `pickKeySource` fails over to OpenRouter) AND fire a Slack alert. The
 * precise combined-float check runs in `stripeIssuing.runIssuingUnderfundCheck`,
 * and the per-card hard monthly cap is enforced in the authorization webhook —
 * both already shipped in HEL-599. This module adds the per-row status
 * actuation + alerting required for the direct path.
 */
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { safeLogJobRun } from "../../adminConsole/infra/jobHistoryStore";
import { setStatus, updatePrepaidBalance } from "./keySourceStore";
import { isIssuingEnabled, postIssuingAlert, readIssuingBalanceUsd } from "./stripeIssuing";

const OPENROUTER_BALANCE_URL = "https://openrouter.ai/api/v1/credits";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const LOW_BALANCE_DAYS = 1;
const HEALTHY_RECOVERY_DAYS = 3;
const TRAILING_WINDOW_HOURS = 24;

export interface OpenRouterCreditsResponse {
  data: {
    /** Total amount of credits ever deposited (USD). */
    total_credits: number;
    /** Amount spent to date (USD). */
    total_usage: number;
  };
}

export interface SourceHealthDeps {
  /** Test hook — override fetch (OpenRouter balance + Slack alert). */
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}

/** A row to health-check, with its key already decrypted by selectRows. */
export interface HealthSourceRow {
  id: string;
  status: string;
  apiKey: string;
}

/** Result shape — unchanged from the original OpenRouter watchdog (compat). */
export interface HealthCheckResult {
  sourcesChecked: number;
  balanceUsd: number | null;
  trailing24hUsd: number;
  flippedToLowBalance: number;
  flippedToActive: number;
}

function emptyResult(): HealthCheckResult {
  return {
    sourcesChecked: 0,
    balanceUsd: null,
    trailing24hUsd: 0,
    flippedToLowBalance: 0,
    flippedToActive: 0,
  };
}

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("sourceHealthJob requires DATABASE_URL outside development/test.");
}

// ---------------------------------------------------------------------------
// Pure decision — extracted so the flip logic is unit-testable without a DB.
// ---------------------------------------------------------------------------

export type HealthFlip = "to_low_balance" | "to_active" | "none";

/**
 * Decide whether a source should flip status given its observed balance vs the
 * trailing-24h spend. `active` → `low_balance` when the balance can't cover
 * `lowBalanceDays` of spend; `low_balance` → `active` once it recovers above
 * `recoveryDays` of spend (hysteresis so it doesn't flap). Never flips when
 * there's no trailing spend to compare against (a fresh source on day 0).
 */
export function decideHealthFlip(args: {
  status: string;
  balanceUsd: number;
  trailingSpendUsd: number;
  lowBalanceDays?: number;
  recoveryDays?: number;
}): HealthFlip {
  const lowDays = args.lowBalanceDays ?? LOW_BALANCE_DAYS;
  const recoveryDays = args.recoveryDays ?? HEALTHY_RECOVERY_DAYS;
  if (args.trailingSpendUsd <= 0) return "none";
  if (args.status === "active" && args.balanceUsd < args.trailingSpendUsd * lowDays) {
    return "to_low_balance";
  }
  if (args.status === "low_balance" && args.balanceUsd >= args.trailingSpendUsd * recoveryDays) {
    return "to_active";
  }
  return "none";
}

// ---------------------------------------------------------------------------
// Trailing spend
// ---------------------------------------------------------------------------

/**
 * Trailing-24h credits-mode wholesale spend. Global when `provider` is
 * omitted (OpenRouter, the catch-all); filtered to one provider for the
 * direct checks.
 */
export async function getTrailingDailySpendUsd(provider?: string): Promise<number> {
  if (!persistenceAvailable()) return 0;
  const result = await queryPostgres<{ wholesale_sum: string | null }>(
    `SELECT COALESCE(SUM(wholesale_cost_usd), 0)::text AS wholesale_sum
       FROM workspace_credit_ledger
      WHERE type = 'consumption'
        AND created_at > now() - ($1::text || ' hours')::interval
        AND ($2::text IS NULL OR provider = $2)`,
    [String(TRAILING_WINDOW_HOURS), provider ?? null],
  );
  return Number(result.rows[0]?.wholesale_sum ?? "0");
}

// ---------------------------------------------------------------------------
// Balance readers
// ---------------------------------------------------------------------------

/**
 * Read OpenRouter's current remaining balance. Returns null on transient
 * errors so the watchdog keeps running — a single failed read shouldn't flip
 * status; the next cycle retries.
 */
export async function readOpenRouterBalance(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(OPENROUTER_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`[sourceHealthJob] openrouter balance HTTP ${res.status} — skipping cycle`);
      return null;
    }
    const body = (await res.json()) as OpenRouterCreditsResponse;
    return (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
  } catch (err) {
    console.warn(
      `[sourceHealthJob] openrouter balance fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Funding signal for the direct cards: the shared Stripe Issuing balance.
 * Anthropic/OpenAI have no reliable public remaining-balance endpoint, so this
 * is the real "can we keep funding the provider?" signal. Returns null when
 * the Issuing layer is disabled or the balance read fails (→ skip, no flip).
 */
async function readIssuingFundingBalance(deps: SourceHealthDeps): Promise<number | null> {
  if (!isIssuingEnabled()) return null;
  try {
    return await readIssuingBalanceUsd({ fetchImpl: deps.fetchImpl });
  } catch (err) {
    (deps.logger ?? console).warn(
      `[sourceHealthJob] could not read Issuing balance: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

export interface SourceHealthConfig {
  jobName: string;
  /** Rows to check, keys already decrypted. Returns [] when no DB (no-op). */
  selectRows: () => Promise<HealthSourceRow[]>;
  /** Remaining-balance signal (USD) for a row. null = transient → skip. */
  readBalance: (apiKey: string, deps: SourceHealthDeps) => Promise<number | null>;
  /** Trailing-24h spend to compare the balance against. */
  trailingSpendUsd: () => Promise<number>;
  /** Fired (best-effort) when a row flips to low_balance. */
  onUnderfund?: (
    ctx: { balanceUsd: number; trailingSpendUsd: number },
    deps: SourceHealthDeps,
  ) => Promise<void>;
}

/**
 * One health-check cycle. Pure of persistence assumptions: it just consumes
 * `selectRows()` (the DB selectors no-op to [] without Postgres) and mutates
 * via the persistence-aware `setStatus` / `updatePrepaidBalance`. That makes
 * the loop + flip + alert path drivable with stub rows in unit tests.
 */
export async function runSourceHealthCheck(
  config: SourceHealthConfig,
  deps?: SourceHealthDeps,
): Promise<HealthCheckResult> {
  const d: SourceHealthDeps = deps ?? {};
  const rows = await config.selectRows();
  if (rows.length === 0) return emptyResult();

  const trailing = await config.trailingSpendUsd();
  let flippedToLowBalance = 0;
  let flippedToActive = 0;
  let lastObservedBalance: number | null = null;

  for (const row of rows) {
    const balance = await config.readBalance(row.apiKey, d);
    if (balance == null) continue;
    lastObservedBalance = balance;
    await updatePrepaidBalance(row.id, balance);

    const flip = decideHealthFlip({
      status: row.status,
      balanceUsd: balance,
      trailingSpendUsd: trailing,
    });
    if (flip === "to_low_balance") {
      await setStatus(row.id, "low_balance");
      flippedToLowBalance += 1;
      (d.logger ?? console).warn(
        `[sourceHealthJob:${config.jobName}] source ${row.id} balance $${balance.toFixed(2)} < ` +
          `${LOW_BALANCE_DAYS}-day trailing spend $${trailing.toFixed(2)} — flipped to low_balance`,
      );
      if (config.onUnderfund) {
        try {
          await config.onUnderfund({ balanceUsd: balance, trailingSpendUsd: trailing }, d);
        } catch (err) {
          (d.logger ?? console).error(
            `[sourceHealthJob:${config.jobName}] underfund alert failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } else if (flip === "to_active") {
      await setStatus(row.id, "active");
      flippedToActive += 1;
      (d.logger ?? console).log(
        `[sourceHealthJob:${config.jobName}] source ${row.id} balance recovered to $${balance.toFixed(2)} — flipped to active`,
      );
    }
  }

  return {
    sourcesChecked: rows.length,
    balanceUsd: lastObservedBalance,
    trailing24hUsd: trailing,
    flippedToLowBalance,
    flippedToActive,
  };
}

// ---------------------------------------------------------------------------
// Row selectors (DB; no-op to [] without Postgres)
// ---------------------------------------------------------------------------

async function selectRowsByQuery(sql: string, params: unknown[]): Promise<HealthSourceRow[]> {
  if (!persistenceAvailable()) return [];
  const pool = getPostgresPool();
  const res = await pool.query<{ id: string; status: string; key_ciphertext: string }>(sql, params);
  const { connectorSecretVault } = await import("../../integrations/shared/credentialRegistry");
  // Decrypt here so the factory loop never handles ciphertext. Skip (drop) a
  // row whose key won't decrypt rather than aborting the whole cycle.
  return res.rows.flatMap((r) => {
    try {
      return [{ id: r.id, status: r.status, apiKey: connectorSecretVault.decrypt(r.key_ciphertext) }];
    } catch (err) {
      console.error(
        `[sourceHealthJob] failed to decrypt key for source ${r.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  });
}

const selectOpenRouterRows = (): Promise<HealthSourceRow[]> =>
  selectRowsByQuery(
    `SELECT id, status, key_ciphertext FROM platform_provider_keys
      WHERE source_kind = 'openrouter' AND status IN ('active','low_balance')`,
    [],
  );

const selectDirectRows = (provider: string) => (): Promise<HealthSourceRow[]> =>
  selectRowsByQuery(
    `SELECT id, status, key_ciphertext FROM platform_provider_keys
      WHERE source_kind = 'direct' AND provider = $1 AND status IN ('active','low_balance')`,
    [provider],
  );

// ---------------------------------------------------------------------------
// Per-source check entry points
// ---------------------------------------------------------------------------

/** OpenRouter watchdog — identical behaviour + result shape to Phase 1. */
export async function runOpenrouterHealthCheck(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<HealthCheckResult> {
  return runSourceHealthCheck(
    {
      jobName: "openrouter_health",
      selectRows: selectOpenRouterRows,
      readBalance: (apiKey, deps) => readOpenRouterBalance(apiKey, deps.fetchImpl ?? fetch),
      trailingSpendUsd: () => getTrailingDailySpendUsd(),
    },
    { fetchImpl: opts?.fetchImpl },
  );
}

function makeDirectHealthCheck(provider: string) {
  return (opts?: {
    fetchImpl?: typeof fetch;
    /** Test hook — override the funding-balance reader. */
    readBalance?: (deps: SourceHealthDeps) => Promise<number | null>;
  }): Promise<HealthCheckResult> => {
    const readFunding = opts?.readBalance ?? readIssuingFundingBalance;
    return runSourceHealthCheck(
      {
        jobName: `direct_health_${provider}`,
        selectRows: selectDirectRows(provider),
        // The direct card's funding source is the shared Issuing balance, not
        // the provider key — readBalance ignores the apiKey here.
        readBalance: (_apiKey, deps) => readFunding(deps),
        trailingSpendUsd: () => getTrailingDailySpendUsd(provider),
        onUnderfund: async ({ balanceUsd, trailingSpendUsd }, deps) => {
          await postIssuingAlert(
            `:rotating_light: ${provider} direct funding low — Issuing balance ` +
              `$${balanceUsd.toFixed(2)} < trailing-24h ${provider} spend $${trailingSpendUsd.toFixed(2)}. ` +
              `Routing ${provider} back to OpenRouter; top up the Issuing balance.`,
            { fetchImpl: deps.fetchImpl },
          );
        },
      },
      { fetchImpl: opts?.fetchImpl },
    );
  };
}

export const runAnthropicHealthCheck = makeDirectHealthCheck("anthropic");
export const runOpenAIHealthCheck = makeDirectHealthCheck("openai");

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

interface SchedulerHandle {
  stop: () => void;
}

/**
 * Start a recurring health-check loop. No-op (dead handle) when Postgres isn't
 * configured. Mirrors the original startOpenrouterHealthJob, generalized over
 * the job name + check function.
 */
export function startSourceHealthJob(opts: {
  jobName: string;
  runCheck: () => Promise<HealthCheckResult>;
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const logger = opts.logger ?? console;
  if (!isPostgresPersistenceEnabled()) {
    logger.log(`[${opts.jobName}] DATABASE_URL not configured — watchdog disabled`);
    return { stop: () => undefined };
  }
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = (): void => {
    const startedAt = new Date();
    opts
      .runCheck()
      .then((result) => {
        if (result.sourcesChecked === 0) return;
        if (result.flippedToLowBalance > 0 || result.flippedToActive > 0) {
          logger.log(
            `[${opts.jobName}] cycle: ${result.sourcesChecked} source(s), ` +
              `balance=$${result.balanceUsd?.toFixed(2) ?? "?"}, ` +
              `trailing24h=$${result.trailing24hUsd.toFixed(2)}, ` +
              `→low_balance=${result.flippedToLowBalance}, →active=${result.flippedToActive}`,
          );
        }
        void safeLogJobRun({
          jobName: opts.jobName,
          startedAt,
          endedAt: new Date(),
          outcome: result.sourcesChecked === 0 ? "skipped" : "success",
          payload: {
            sources_checked: result.sourcesChecked,
            balance_usd: result.balanceUsd,
            trailing_24h_usd: result.trailing24hUsd,
            flipped_to_low_balance: result.flippedToLowBalance,
            flipped_to_active: result.flippedToActive,
          },
        });
      })
      .catch((err) => {
        logger.error(
          `[${opts.jobName}] cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        void safeLogJobRun({
          jobName: opts.jobName,
          startedAt,
          endedAt: new Date(),
          outcome: "failure",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[${opts.jobName}] watchdog started, interval=${intervalMs}ms`);
  return { stop: () => clearInterval(handle) };
}

/** OpenRouter scheduler — compat wrapper (re-exported by openrouterHealthJob.ts). */
export function startOpenrouterHealthJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  return startSourceHealthJob({
    jobName: "openrouter_health",
    runCheck: () => runOpenrouterHealthCheck(),
    intervalMs: opts?.intervalMs,
    logger: opts?.logger,
  });
}

/**
 * Start the direct-provider funding watchdogs (Anthropic + OpenAI). Gated on
 * STRIPE_ISSUING_ENABLED — the whole direct/treasury path ships disabled — so
 * this is a no-op until ops turns it on at go-live.
 */
export function startDirectProviderHealthJobs(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle[] {
  const logger = opts?.logger ?? console;
  if (!isIssuingEnabled()) {
    logger.log("[direct_health] STRIPE_ISSUING_ENABLED not set — direct funding watchdogs disabled");
    return [];
  }
  return [
    startSourceHealthJob({
      jobName: "direct_health_anthropic",
      runCheck: () => runAnthropicHealthCheck(),
      intervalMs: opts?.intervalMs,
      logger: opts?.logger,
    }),
    startSourceHealthJob({
      jobName: "direct_health_openai",
      runCheck: () => runOpenAIHealthCheck(),
      intervalMs: opts?.intervalMs,
      logger: opts?.logger,
    }),
  ];
}
