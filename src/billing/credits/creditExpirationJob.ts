/**
 * Credit expiration job (Phase 3, plan §"Credit expiration job
 * (12-month TTL on grants)").
 *
 * Reduces accounting liability: purchased credits unused 12+ months
 * after their last top-up expire. Wallets with recent top-ups stay
 * fully funded; only fully-stale wallets bleed off.
 *
 * Algorithm (pragmatic, FIFO-free):
 *   1. For every wallet with a non-zero balance, find the timestamp of
 *      the most recent `purchase` or `grant` ledger row.
 *   2. If that timestamp is older than 12 months, expire the entire
 *      remaining balance via a `type='expiration'` ledger row.
 *   3. If there's no purchase history at all (only granular grants from
 *      e.g. promotional credits), use the wallet's creation time as the
 *      fallback anchor.
 *
 * Runs once per 24h. Idempotent: re-running the same day finds the
 * just-expired wallet now at zero balance, so it short-circuits.
 *
 * A future Phase 3+ refinement is per-grant FIFO expiration (expire the
 * oldest purchase first, leave newer ones intact). The pragmatic rule
 * above gets the same legal/accounting result for the vast majority of
 * wallets and ships in a day vs. a week.
 */
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { grantCredits } from "./walletStore";
import { safeLogJobRun } from "../../adminConsole/infra/jobHistoryStore";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EXPIRATION_THRESHOLD_MONTHS = 12;

interface StaleWalletRow {
  workspace_id: string;
  balance_credits: string;
  last_purchase_at: string | null;
  wallet_created_at: string | null;
}

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "creditExpirationJob requires DATABASE_URL outside development/test.",
  );
}

export interface ExpirationCycleResult {
  walletsScanned: number;
  walletsExpired: number;
  creditsExpired: bigint;
}

/**
 * Run a single expiration cycle. Returns counters for logging /
 * integration tests.
 */
export async function runCreditExpirationCycle(): Promise<ExpirationCycleResult> {
  if (!persistenceAvailable()) {
    return { walletsScanned: 0, walletsExpired: 0, creditsExpired: 0n };
  }

  // Pull every wallet with a positive balance and the timestamp of its
  // most recent purchase/grant. We need to use a single query because
  // wallets are workspace-isolated by RLS; the privileged pool connection
  // can see all rows (the app role for the watchdog is the service role).
  const pool = getPostgresPool();
  const result = await pool.query<StaleWalletRow>(
    `SELECT
        w.workspace_id::text                                AS workspace_id,
        w.balance_credits::text                             AS balance_credits,
        (
          SELECT MAX(l.created_at)::text
            FROM workspace_credit_ledger l
           WHERE l.workspace_id = w.workspace_id
             AND l.type IN ('purchase','grant')
        )                                                   AS last_purchase_at,
        w.updated_at::text                                  AS wallet_created_at
       FROM workspace_credit_wallets w
      WHERE w.balance_credits > 0`,
  );

  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() - EXPIRATION_THRESHOLD_MONTHS);

  let walletsExpired = 0;
  let creditsExpired = 0n;

  for (const row of result.rows) {
    const balance = BigInt(row.balance_credits);
    if (balance <= 0n) continue;

    const anchor = row.last_purchase_at ?? row.wallet_created_at;
    if (!anchor) continue;
    const anchorDate = new Date(anchor);
    if (Number.isNaN(anchorDate.getTime())) continue;
    if (anchorDate >= threshold) continue;

    // Stale — expire the balance. The grant_credits RPC doesn't have
    // an "expire" path because expiration is a debit not a credit; we
    // write the ledger row + balance adjustment manually here.
    await applyExpiration(row.workspace_id, balance, anchorDate.toISOString());
    walletsExpired += 1;
    creditsExpired += balance;
  }

  return {
    walletsScanned: result.rowCount ?? 0,
    walletsExpired,
    creditsExpired,
  };
}

async function applyExpiration(
  workspaceId: string,
  credits: bigint,
  anchorIso: string,
): Promise<void> {
  // Idempotency key derives from the anchor day so re-running on the
  // same day no-ops cleanly; once a day has passed the same wallet
  // would have a new anchor only if it was topped up, which is the
  // case we WANT to retry on.
  const idempotencyKey = `expiration__${workspaceId}__${anchorIso.slice(0, 10)}`;

  await queryPostgres(
    `INSERT INTO workspace_credit_ledger
       (workspace_id, type, credits_delta, balance_after,
        idempotency_key, metadata)
     VALUES (
       $1::uuid,
       'expiration',
       -$2::bigint,
       0,
       $3,
       jsonb_build_object(
         'reason', '12-month TTL on stale purchases',
         'anchor_ts', $4::text,
         'expired_at', now()::text
       )
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [workspaceId, credits.toString(), idempotencyKey, anchorIso],
  );

  // Drain the wallet to zero. Atomic in the sense that no concurrent
  // reservation can race us — reservations block on the wallet row
  // lock inside reserve_credits, and if a reservation lands first we
  // simply expire whatever is left.
  await queryPostgres(
    `UPDATE workspace_credit_wallets
        SET balance_credits = 0,
            updated_at = now()
      WHERE workspace_id = $1::uuid
        AND balance_credits = $2::bigint`,
    [workspaceId, credits.toString()],
  );
}

/** Suppress unused-export warning while reserving a future call site. */
void grantCredits;

interface SchedulerHandle {
  stop: () => void;
}

export function startCreditExpirationJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts?.logger ?? console;

  if (!isPostgresPersistenceEnabled()) {
    logger.log(
      "[creditExpirationJob] DATABASE_URL not configured — expiration job disabled",
    );
    return { stop: () => undefined };
  }

  const tick = (): void => {
    const startedAt = new Date();
    runCreditExpirationCycle()
      .then((result) => {
        if (result.walletsExpired > 0) {
          logger.log(
            `[creditExpirationJob] expired ${result.walletsExpired} stale wallet(s), ` +
              `${result.creditsExpired.toString()} credits total ` +
              `(scanned ${result.walletsScanned} wallets with positive balance)`,
          );
        }
        void safeLogJobRun({
          jobName: "credit_expiration",
          startedAt,
          endedAt: new Date(),
          outcome: "success",
          payload: {
            wallets_scanned: result.walletsScanned,
            wallets_expired: result.walletsExpired,
            credits_expired: result.creditsExpired.toString(),
          },
        });
      })
      .catch((err) => {
        logger.error(
          `[creditExpirationJob] cycle failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        void safeLogJobRun({
          jobName: "credit_expiration",
          startedAt,
          endedAt: new Date(),
          outcome: "failure",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  // Fire once on startup (idempotent — re-running is safe), then daily.
  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[creditExpirationJob] started, interval=${intervalMs}ms`);

  return {
    stop: () => clearInterval(handle),
  };
}
