/**
 * Cross-instance coordinator lock (HEL-458 / B1).
 *
 * The approval-resume / approval-notification / ticket-SLA / prompt-routine
 * sweeps each run on a `setInterval` in EVERY API instance. They read pending
 * work from Postgres but previously deduped concurrent processing only with a
 * process-local `Set`, so on the 2-machine prod fleet both instances picked up
 * the same pending rows on the same tick and double-processed them (duplicate
 * approval emails, double workflow resumes with duplicated LLM spend + side
 * effects, duplicate SLA escalations / routine runs).
 *
 * `runWithAdvisoryLock` gates a sweep behind a Postgres *session* advisory lock
 * (`pg_try_advisory_lock`) so only one instance runs a given coordinator's
 * sweep at a time. The lock is held on a dedicated pooled connection for the
 * duration of the sweep and released in `finally`; if the process dies
 * mid-sweep the lock is auto-released when the connection closes, so there are
 * no stuck locks. The in-process `Set` in each coordinator stays as a
 * within-process fast path but is no longer the correctness boundary.
 *
 * Degradation: in dev/test (no Postgres) the lock is a no-op and `fn` always
 * runs. If acquiring the lock errors (e.g. a transient Postgres outage) we log
 * and run `fn` anyway — the same best-effort behavior as before this change, so
 * a DB blip never silently halts all coordinators.
 */

import { getPostgresPool, isPostgresConfigured } from "../db/postgres";

/**
 * Distinct advisory-lock keys, one per coordinator. `pg_try_advisory_lock` is a
 * per-database lock keyed by a single bigint, so each coordinator needs its own
 * key (otherwise they'd serialize against each other). Arbitrary but stable.
 */
export const CoordinatorLockKey = {
  approvalNotification: 814_730_001,
  approvalResume: 814_730_002,
  ticketNotification: 814_730_003,
  promptRoutine: 814_730_004,
} as const;

/**
 * Run `fn` only if this instance can acquire the advisory lock `lockKey`.
 * Returns `true` if `fn` ran (lock acquired, or no-Postgres/degraded path),
 * `false` if another instance holds the lock and this sweep was skipped.
 */
export async function runWithAdvisoryLock(
  lockKey: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!isPostgresConfigured()) {
    await fn();
    return true;
  }

  let client;
  try {
    client = await getPostgresPool().connect();
  } catch (err) {
    console.warn(
      `[coordinatorLock] could not acquire a connection for lock ${lockKey}; running without the lock:`,
      (err as Error).message,
    );
    await fn();
    return true;
  }

  try {
    let locked: boolean;
    try {
      const res = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [lockKey],
      );
      locked = res.rows[0]?.locked === true;
    } catch (err) {
      console.warn(
        `[coordinatorLock] advisory-lock query failed for ${lockKey}; running without the lock:`,
        (err as Error).message,
      );
      await fn();
      return true;
    }

    if (!locked) {
      return false;
    }

    try {
      await fn();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [lockKey])
        .catch((err) =>
          console.warn(
            `[coordinatorLock] advisory-unlock failed for ${lockKey}:`,
            (err as Error).message,
          ),
        );
    }
    return true;
  } finally {
    client.release();
  }
}
