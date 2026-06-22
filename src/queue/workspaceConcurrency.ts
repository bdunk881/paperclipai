/**
 * HEL-699: per-tenant (per-workspace) concurrency gate.
 *
 * The `runs` worker has a single global `concurrency` (5), so one busy workspace
 * can occupy every slot and starve others. This caps the number of runs a single
 * workspace executes concurrently on the shared pool. Free BullMQ has no native
 * per-key concurrency, so we gate with a Redis counter: a run acquires a slot
 * before executing inline and releases it after; if the workspace is at its cap
 * the job is re-enqueued with a short delay (by the worker) so it retries when a
 * slot frees — backpressure, not starvation (the workspace's in-flight runs
 * release slots as they finish).
 *
 * Default OFF: with `RUN_WORKSPACE_CONCURRENCY` unset/≤0 there is no gating
 * (today's behavior). Isolated runs (HEL-807) execute off-pool and are not gated
 * here.
 */

/** Minimal Redis surface used by the gate (satisfied by the ioredis client). */
export interface ConcurrencyRedis {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
}

/** Re-check delay when a workspace is at its cap (worker adds small jitter). */
export const WORKSPACE_DEFER_MS = 2_000;
/**
 * TTL on each counter so a leaked slot (worker killed between acquire and
 * release) self-heals. Must exceed the longest run; comfortably above the
 * 30-min maxDuration default.
 */
export const WORKSPACE_SLOT_TTL_SECONDS = 60 * 60;

function counterKey(workspaceId: string): string {
  return `runconc:${workspaceId}`;
}

/**
 * Per-workspace concurrent-run cap from `RUN_WORKSPACE_CONCURRENCY`. Returns 0
 * (gating disabled) when unset, non-numeric, or ≤ 0.
 */
export function resolveWorkspaceConcurrencyLimit(): number {
  const n = Number(process.env.RUN_WORKSPACE_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Try to take a concurrency slot for `workspaceId`. Atomic INCR; if it pushes
 * the count over `limit` we give the slot back (DECR) and return false. Refreshes
 * the key TTL so a crashed holder's slot self-heals.
 */
export async function acquireWorkspaceSlot(
  redis: ConcurrencyRedis,
  workspaceId: string,
  limit: number,
): Promise<boolean> {
  const key = counterKey(workspaceId);
  const count = await redis.incr(key);
  await redis.expire(key, WORKSPACE_SLOT_TTL_SECONDS);
  if (count > limit) {
    await redis.decr(key);
    return false;
  }
  return true;
}

/** Release a slot for `workspaceId`, flooring at 0 (never negative on drift). */
export async function releaseWorkspaceSlot(
  redis: ConcurrencyRedis,
  workspaceId: string,
): Promise<void> {
  const key = counterKey(workspaceId);
  const count = await redis.decr(key);
  if (count < 0) {
    await redis.set(key, "0");
  }
}
