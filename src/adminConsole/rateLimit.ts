/**
 * Per-admin rate limits for high-impact actions.
 *
 * In-memory counter; resets on process restart. Good enough for the v1 single-
 * instance API. When the API scales horizontally, switch the backing store to
 * Redis (existing src/cache/redis.ts) — the interface here stays the same.
 *
 * Limits enforced (configurable via env):
 *   refunds       — max 5 / day per admin
 *   impersonation — max 3 / hour per admin
 *   user_deletion — max 2 / day per admin
 *   mfa_resets    — max 10 / day per admin
 */

type WindowKey = "hour" | "day";

interface BucketConfig {
  limit: number;
  window: WindowKey;
}

const DEFAULT_BUCKETS: Record<string, BucketConfig> = {
  refunds: { limit: 5, window: "day" },
  impersonation: { limit: 3, window: "hour" },
  user_deletion: { limit: 2, window: "day" },
  mfa_resets: { limit: 10, window: "day" },
  password_resets: { limit: 50, window: "day" },
  // HEL-250: rotation is the high-impact path (every rotation forces a fresh
  // balance recompute and momentarily affects the customer credits path).
  // Create/disable have their own audit trail but no hard daily cap.
  provider_key_rotations: { limit: 10, window: "day" },

  // HEL infra dashboard PR #2: Ask-an-Agent send rate. Per-admin; protects
  // misconfigured webhooks from spamming receivers and gives accidental
  // double-click protection.
  ask_agent: { limit: 30, window: "hour" },
  // Test-fire from the Settings page; lower than ask_agent so a careless
  // admin can't loop on it.
  test_agent_webhook: { limit: 10, window: "hour" },

  // HEL infra dashboard PR #6: Compute mutations. Production-side blast
  // radius governs the limit; reads-first means we tune these down further
  // after observing real usage.
  restart_fly_machine: { limit: 10, window: "hour" },
  retry_queue_job: { limit: 30, window: "hour" },
  promote_queue_job: { limit: 30, window: "hour" },
  remove_queue_job: { limit: 20, window: "hour" },
  replay_dlq_job: { limit: 30, window: "hour" },
  // Pause/drain are coarser controls — keep their limits low so an admin
  // can't accidentally pause every queue at once.
  pause_queue: { limit: 5, window: "day" },
  resume_queue: { limit: 10, window: "day" },
  drain_queue: { limit: 2, window: "day" },
  trigger_scheduled_job: { limit: 10, window: "hour" },

  // HEL infra dashboard PR #7: Edge + Data mutations.
  rollback_cf_pages_deploy: { limit: 5, window: "day" },
  retry_cf_pages_deploy: { limit: 10, window: "day" },
  rerun_workflow_run: { limit: 20, window: "hour" },
  cancel_workflow_run: { limit: 20, window: "hour" },
  kill_postgres_query: { limit: 10, window: "hour" },
  // Pattern-based key flushes are blast-radius-heavy even with the
  // deny-list — keep this tight.
  flush_redis_pattern: { limit: 5, window: "day" },
};

function envOverride(name: string): number | undefined {
  const v = process.env[`ADMIN_RATE_LIMIT_${name.toUpperCase()}`];
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function windowMillis(window: WindowKey): number {
  return window === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

interface Entry {
  count: number;
  resetAt: number;
}

// allowlist: process-local admin-console rate-limit counters (per machine; resets on restart by design)
const store = new Map<string, Entry>();

function key(adminUserId: string, bucket: string): string {
  return `${bucket}::${adminUserId}`;
}

/**
 * Check + increment. Throws an Error with `.code = "rate_limited"` when the
 * bucket would be exceeded. On success, the count is incremented.
 */
export function consumeRateLimit(adminUserId: string, bucket: string): void {
  const cfg = DEFAULT_BUCKETS[bucket];
  if (!cfg) {
    // Unknown bucket — treat as no limit. We don't want misspelled buckets to
    // silently let unlimited actions through, but blocking outright would be
    // worse. Log loudly.
    console.warn(`[adminConsole/rateLimit] unknown bucket "${bucket}"`);
    return;
  }
  const limit = envOverride(bucket) ?? cfg.limit;
  const now = Date.now();
  const k = key(adminUserId, bucket);
  const entry = store.get(k);
  if (!entry || entry.resetAt <= now) {
    store.set(k, { count: 1, resetAt: now + windowMillis(cfg.window) });
    return;
  }
  if (entry.count >= limit) {
    const err = new Error(
      `Rate limit exceeded for "${bucket}" — max ${limit} per ${cfg.window} per admin`,
    );
    (err as Error & { code?: string; bucket?: string }).code = "rate_limited";
    (err as Error & { bucket?: string }).bucket = bucket;
    throw err;
  }
  entry.count += 1;
}

/** Test-only — wipe in-memory state. */
export function __resetRateLimitsForTests(): void {
  store.clear();
}
