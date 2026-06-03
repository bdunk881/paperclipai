/**
 * Durable per-scope daily usage counter (HEL-467 / B8).
 *
 * Replaces the process-local in-memory `Map`s that previously enforced daily
 * quotas (hosted-free token cap, agent-memory semantic-search limit). Those
 * counters were per-instance and reset on restart, so on the multi-machine
 * prod deploy each instance got its own allowance and a deploy wiped the count.
 *
 * Strategy:
 *   - **Postgres is the source of truth** — every increment is an atomic
 *     upsert into `daily_usage` that returns the new running total, so the
 *     count is correct across instances and survives restarts.
 *   - **Redis is a read-through cache** in front of the hot-path check, keyed
 *     identically with a TTL to UTC midnight. Because Redis is shared across
 *     instances (Upstash), the cache is cross-instance consistent; if Redis is
 *     down we fall back to a Postgres read. The cache is best-effort — a miss
 *     or error never blocks the call.
 *   - **In-memory fallback** only when Postgres persistence is disabled AND
 *     `inMemoryAllowed()` (dev/test), mirroring the other stores.
 *
 * `scopeId` is generic: a workspace id for `hosted_free_tokens`, a user id for
 * `semantic_search`. `dayKey` is the UTC `YYYY-MM-DD` so the counter rolls over
 * at UTC midnight with no separate cron.
 */

import {
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { getRedisClient } from "../../queue/redisClient";

export type UsageMetric = "hosted_free_tokens" | "semantic_search";

export function usageDayKey(now: Date = new Date()): string {
  // UTC YYYY-MM-DD — stable regardless of the scope owner's locale.
  return now.toISOString().slice(0, 10);
}

// allowlist: dev/test-only fallback; Postgres is the source of truth in prod
const memoryCounter = new Map<string, number>();

function memoryKey(metric: UsageMetric, scopeId: string, dayKey: string): string {
  return `${metric}:${scopeId}:${dayKey}`;
}

function redisKey(metric: UsageMetric, scopeId: string, dayKey: string): string {
  return `usage:${metric}:${scopeId}:${dayKey}`;
}

/**
 * Whether Postgres persistence is available. Mirrors the runStore /
 * companyLifecycleStore guard: in prod Postgres is required; dev/test may opt
 * into the in-memory fallback via `AUTOFLOW_ALLOW_INMEMORY=true`.
 */
function postgresMode(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("dailyUsageCounter requires DATABASE_URL outside development/test.");
}

function secondsUntilUtcMidnight(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

async function writeCache(
  metric: UsageMetric,
  scopeId: string,
  dayKey: string,
  total: number,
  now: Date,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    // TTL slightly past midnight so a stale key can't outlive its day.
    await redis.set(
      redisKey(metric, scopeId, dayKey),
      String(total),
      "EX",
      secondsUntilUtcMidnight(now) + 60,
    );
  } catch {
    // Best-effort cache — never block on Redis.
  }
}

/**
 * Atomically add `amount` (clamped to a non-negative integer) to the scope's
 * counter for the current UTC day and return the new running total. The
 * Postgres upsert is authoritative; the Redis cache is updated best-effort.
 */
export async function consumeDailyUsage(
  metric: UsageMetric,
  scopeId: string,
  amount: number,
  now: Date = new Date(),
): Promise<number> {
  const dayKey = usageDayKey(now);
  const inc = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;

  if (!postgresMode()) {
    const key = memoryKey(metric, scopeId, dayKey);
    const total = (memoryCounter.get(key) ?? 0) + inc;
    memoryCounter.set(key, total);
    return total;
  }

  const result = await queryPostgres<{ amount: string }>(
    `INSERT INTO daily_usage (scope_id, metric, day_key, amount)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope_id, metric, day_key)
     DO UPDATE SET amount = daily_usage.amount + EXCLUDED.amount,
                   updated_at = NOW()
       RETURNING amount`,
    [scopeId, metric, dayKey, inc],
  );
  const total = Number(result.rows[0]?.amount ?? inc);
  await writeCache(metric, scopeId, dayKey, total, now);
  return total;
}

/**
 * Read the scope's current running total for the UTC day. Redis first (shared
 * across instances), falling back to the authoritative Postgres row on a cache
 * miss or Redis error.
 */
export async function getDailyUsage(
  metric: UsageMetric,
  scopeId: string,
  now: Date = new Date(),
): Promise<number> {
  const dayKey = usageDayKey(now);

  if (!postgresMode()) {
    return memoryCounter.get(memoryKey(metric, scopeId, dayKey)) ?? 0;
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(redisKey(metric, scopeId, dayKey));
      if (cached !== null) {
        const parsed = Number(cached);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      // Fall through to Postgres.
    }
  }

  const result = await queryPostgres<{ amount: string }>(
    `SELECT amount FROM daily_usage
      WHERE scope_id = $1 AND metric = $2 AND day_key = $3`,
    [scopeId, metric, dayKey],
  );
  const total = result.rows.length ? Number(result.rows[0].amount) : 0;
  await writeCache(metric, scopeId, dayKey, total, now);
  return total;
}

/** Test-only — clears the in-memory fallback counter. */
export function __resetDailyUsageForTests(): void {
  memoryCounter.clear();
}

/** Test-only — seeds the in-memory fallback counter for a scope/day. */
export function __seedDailyUsageForTests(
  metric: UsageMetric,
  scopeId: string,
  amount: number,
  dayKey: string = usageDayKey(),
): void {
  memoryCounter.set(memoryKey(metric, scopeId, dayKey), amount);
}
