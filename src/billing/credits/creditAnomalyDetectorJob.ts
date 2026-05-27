/**
 * Credits anomaly detector (Phase 3, plan §"Anomaly detector +
 * Slack alerts").
 *
 * Watches the ledger every 5 minutes for three patterns that are
 * either suspicious (could be fraud or a runaway agent) or operational
 * (stuck reservations bleed locked credits). On match, fires a Slack
 * alert via SLACK_ALERT_WEBHOOK_URL (a generic incoming-webhook URL —
 * separate from the customer-facing notifyCSM flow which uses the
 * paperclip API).
 *
 * Patterns:
 *   1. **Hourly spike**: a workspace's trailing-1h consumption is
 *      >= 10× its trailing-24h-average (per hour). Catches runaway
 *      loops, fraud probes, and one-off accidents.
 *   2. **Stuck reservations**: a workspace has reservation ledger
 *      rows older than 30 minutes with no matching commit/release.
 *      Means a caller crashed mid-call and locked credits forever.
 *      Operationally important — the customer can't see the locked
 *      credits and may complain about a "wrong" balance.
 *   3. **Daily platform spend**: total wholesale_cost_usd across
 *      every workspace in the last 24h exceeds CREDIT_DAILY_SPEND_ALERT_USD
 *      (default $500). Tripwire for "we under-priced something" or
 *      a viral incident across many workspaces.
 *
 * Dedupe: each (pattern, workspaceId) tuple is suppressed for 1 hour
 * after firing. Process-local — restarts re-arm immediately, which is
 * noisy but acceptable for a v1.
 */
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../../db/postgres";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEDUPE_COOLDOWN_MS = 60 * 60 * 1000;
const SPIKE_MULTIPLIER = 10;
const STUCK_RESERVATION_MINUTES = 30;
const DEFAULT_DAILY_SPEND_ALERT_USD = 500;

interface SpikeRow {
  workspace_id: string;
  hourly_credits: string;
  trailing_24h_credits: string;
  hourly_avg_24h: string;
}

interface StuckReservationRow {
  workspace_id: string;
  reservation_count: string;
  total_locked_credits: string;
}

interface DailySpendRow {
  wholesale_total: string;
}

interface AnomalySummary {
  spikes: SpikeRow[];
  stuck: StuckReservationRow[];
  dailyPlatformSpendUsd: number;
}

// Dedupe map for alert suppression — process-local by design.
// Re-arms on restart (acceptable for v1 anomaly detection).
// allowlist: process-local alert dedupe; restarts re-arm intentionally.
const recentAlerts = new Map<string, number>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "creditAnomalyDetectorJob requires DATABASE_URL outside development/test.",
  );
}

function dailySpendThresholdUsd(): number {
  const raw = process.env.CREDIT_DAILY_SPEND_ALERT_USD;
  if (!raw) return DEFAULT_DAILY_SPEND_ALERT_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_SPEND_ALERT_USD;
}

/**
 * Find workspaces whose trailing-1h consumption is >= SPIKE_MULTIPLIER
 * times their hourly average over the trailing 24h.
 */
async function findHourlySpikes(): Promise<SpikeRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<SpikeRow>(
    `WITH last_hour AS (
       SELECT workspace_id, COALESCE(SUM(-credits_delta), 0)::text AS hourly_credits
         FROM workspace_credit_ledger
        WHERE type = 'consumption'
          AND created_at > now() - interval '1 hour'
        GROUP BY workspace_id
     ),
     trailing_24h AS (
       SELECT workspace_id, COALESCE(SUM(-credits_delta), 0) AS trailing_24h_credits
         FROM workspace_credit_ledger
        WHERE type = 'consumption'
          AND created_at > now() - interval '24 hours'
          AND created_at <= now() - interval '1 hour'
        GROUP BY workspace_id
     )
     SELECT
       lh.workspace_id::text,
       lh.hourly_credits,
       COALESCE(t24.trailing_24h_credits, 0)::text AS trailing_24h_credits,
       (COALESCE(t24.trailing_24h_credits, 0)::numeric / 23)::text AS hourly_avg_24h
       FROM last_hour lh
       LEFT JOIN trailing_24h t24 ON t24.workspace_id = lh.workspace_id
      WHERE lh.hourly_credits::bigint >= 1000  -- ignore noise below ~10 cents
        AND (
              t24.trailing_24h_credits IS NULL
              OR lh.hourly_credits::bigint >= $1::bigint * (t24.trailing_24h_credits / 23)
            )`,
    [SPIKE_MULTIPLIER],
  );
  return result.rows;
}

/**
 * Find workspaces with reservation rows that have aged past the
 * stuck-reservation threshold without a matching commit/release.
 *
 * A "matching" row is identified by the relationship between the
 * reservation's idempotency_key and the commit/release's
 * idempotency_key — convention is `{callKey}__reserve` reserved,
 * `{callKey}__commit` committed, `{callKey}__release` released.
 */
async function findStuckReservations(): Promise<StuckReservationRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<StuckReservationRow>(
    `SELECT
       r.workspace_id::text,
       COUNT(*)::text AS reservation_count,
       COALESCE(SUM(-r.credits_delta), 0)::text AS total_locked_credits
       FROM workspace_credit_ledger r
      WHERE r.type = 'reservation'
        AND r.created_at < now() - ($1::text || ' minutes')::interval
        AND NOT EXISTS (
              SELECT 1
                FROM workspace_credit_ledger followup
               WHERE followup.workspace_id = r.workspace_id
                 AND followup.type IN ('consumption','release')
                 AND followup.idempotency_key LIKE
                       (replace(r.idempotency_key, '__reserve', '') || '__%')
            )
      GROUP BY r.workspace_id`,
    [String(STUCK_RESERVATION_MINUTES)],
  );
  return result.rows;
}

/**
 * Trailing-24h wholesale spend across every workspace.
 */
async function getPlatformDailySpendUsd(): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query<DailySpendRow>(
    `SELECT COALESCE(SUM(wholesale_cost_usd), 0)::text AS wholesale_total
       FROM workspace_credit_ledger
      WHERE type = 'consumption'
        AND created_at > now() - interval '24 hours'`,
  );
  return Number(result.rows[0]?.wholesale_total ?? "0");
}

/**
 * Post a Slack-formatted alert. The URL is read from
 * SLACK_ALERT_WEBHOOK_URL — when unset the alert is logged to stderr
 * so it still shows up in container logs.
 */
async function postSlackAlert(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    console.warn(`[creditAnomalyDetector] ${text}`);
    return;
  }
  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error(
      `[creditAnomalyDetector] slack webhook post failed: ${
        err instanceof Error ? err.message : String(err)
      } — original alert: ${text}`,
    );
  }
}

function shouldSuppress(key: string, now: number = Date.now()): boolean {
  const last = recentAlerts.get(key);
  if (last == null) return false;
  return now - last < DEDUPE_COOLDOWN_MS;
}

function markAlerted(key: string, now: number = Date.now()): void {
  recentAlerts.set(key, now);
  // Trim entries older than 24h so the map doesn't grow unbounded.
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [k, t] of recentAlerts) {
    if (t < cutoff) recentAlerts.delete(k);
  }
}

export interface DetectorCycleResult {
  spikes: number;
  stuckWorkspaces: number;
  dailyPlatformSpendUsd: number;
  alertsFired: number;
  alertsSuppressed: number;
}

export async function runCreditAnomalyDetection(opts?: {
  fetchImpl?: typeof fetch;
  /** Test hook — override Date.now() so dedupe windows are deterministic. */
  now?: number;
}): Promise<DetectorCycleResult> {
  if (!persistenceAvailable()) {
    return {
      spikes: 0,
      stuckWorkspaces: 0,
      dailyPlatformSpendUsd: 0,
      alertsFired: 0,
      alertsSuppressed: 0,
    };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const now = opts?.now ?? Date.now();

  let alertsFired = 0;
  let alertsSuppressed = 0;

  const summary: AnomalySummary = {
    spikes: await findHourlySpikes(),
    stuck: await findStuckReservations(),
    dailyPlatformSpendUsd: await getPlatformDailySpendUsd(),
  };

  // Spike alerts
  for (const row of summary.spikes) {
    const key = `spike::${row.workspace_id}`;
    if (shouldSuppress(key, now)) {
      alertsSuppressed += 1;
      continue;
    }
    const trailing = Number(row.hourly_avg_24h);
    const hourly = Number(row.hourly_credits);
    const ratio = trailing > 0 ? (hourly / trailing).toFixed(1) : "∞";
    await postSlackAlert(
      `:warning: Credit usage spike — workspace \`${row.workspace_id}\` consumed ` +
        `${row.hourly_credits} credits in the last hour (${ratio}× the 24h hourly average). ` +
        `Check for a runaway loop or unauthorized usage.`,
      fetchImpl,
    );
    markAlerted(key, now);
    alertsFired += 1;
  }

  // Stuck-reservation alerts
  for (const row of summary.stuck) {
    const key = `stuck::${row.workspace_id}`;
    if (shouldSuppress(key, now)) {
      alertsSuppressed += 1;
      continue;
    }
    await postSlackAlert(
      `:hourglass_flowing_sand: Stuck credit reservations — workspace \`${row.workspace_id}\` ` +
        `has ${row.reservation_count} reservation(s) older than ${STUCK_RESERVATION_MINUTES} minutes ` +
        `totaling ${row.total_locked_credits} locked credits. ` +
        `Probable cause: a caller crashed between reserve and commit. ` +
        `Run a release pass or manually expire to unstick the wallet.`,
      fetchImpl,
    );
    markAlerted(key, now);
    alertsFired += 1;
  }

  // Daily platform-spend alert
  const dailyThreshold = dailySpendThresholdUsd();
  if (summary.dailyPlatformSpendUsd >= dailyThreshold) {
    const key = `daily_platform_spend`;
    if (shouldSuppress(key, now)) {
      alertsSuppressed += 1;
    } else {
      await postSlackAlert(
        `:money_with_wings: Platform daily wholesale spend ` +
          `$${summary.dailyPlatformSpendUsd.toFixed(2)} crossed the ` +
          `$${dailyThreshold.toFixed(2)} alert threshold (trailing 24h). ` +
          `Review the ledger; consider raising prices or capping highest-spend workspaces.`,
        fetchImpl,
      );
      markAlerted(key, now);
      alertsFired += 1;
    }
  }

  return {
    spikes: summary.spikes.length,
    stuckWorkspaces: summary.stuck.length,
    dailyPlatformSpendUsd: summary.dailyPlatformSpendUsd,
    alertsFired,
    alertsSuppressed,
  };
}

interface SchedulerHandle {
  stop: () => void;
}

export function startCreditAnomalyDetector(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts?.logger ?? console;

  if (!isPostgresPersistenceEnabled()) {
    logger.log(
      "[creditAnomalyDetector] DATABASE_URL not configured — detector disabled",
    );
    return { stop: () => undefined };
  }

  const tick = (): void => {
    runCreditAnomalyDetection()
      .then((result) => {
        if (result.alertsFired > 0) {
          logger.log(
            `[creditAnomalyDetector] cycle: ${result.alertsFired} alert(s) fired, ` +
              `${result.alertsSuppressed} suppressed by dedupe, ` +
              `spikes=${result.spikes}, stuck=${result.stuckWorkspaces}, ` +
              `dailyPlatformSpend=$${result.dailyPlatformSpendUsd.toFixed(2)}`,
          );
        }
      })
      .catch((err) => {
        logger.error(
          `[creditAnomalyDetector] cycle failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[creditAnomalyDetector] started, interval=${intervalMs}ms`);

  return { stop: () => clearInterval(handle) };
}

export function __resetForTests(): void {
  recentAlerts.clear();
}
