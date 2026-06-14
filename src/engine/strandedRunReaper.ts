/**
 * Crash-resume reaper (HEL-695).
 *
 * A SIGKILL mid-`_runSteps` strands a run `status='running'` forever — BullMQ's
 * stalled re-delivery hits `executeQueuedRun`'s status guard and is skipped. This
 * reaper finds runs stuck `running` past a stale threshold and re-enqueues a
 * replay-from-0, which the HEL-696 per-step idempotency makes safe (already
 * completed side-effecting steps are reused, not re-fired).
 *
 * `updated_at` is bumped per step, so it is the liveness signal: a crashed run's
 * `updated_at` freezes at its last completed step. Legitimately-paused runs are
 * excluded for free — both wait paths set status `queued` and approvals set
 * `awaiting_approval`, so only a genuinely mid-execution crash is `running`+stale.
 *
 * Resurrection is bounded by `resume_attempts`: past `maxAttempts` the run is
 * failed instead of resurrected. Sibling to `approvalResumeCoordinator`: an
 * advisory-locked `setInterval` sweep so a multi-instance fleet doesn't double-reap.
 *
 * Liveness caveat: there is no per-step heartbeat, so a single step running
 * longer than `staleMs` could be resurrected (double-running just that in-flight
 * step; completed steps are idempotency-safe). Keep `staleMs` comfortably above
 * the longest expected step; a worker heartbeat for precise liveness is a follow-up.
 */
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import type { RunJobPayload } from "../queue/queues";
import { getRunQueue } from "../queue/queues";
import { isJobIdAlreadyExists } from "../queue/bullMqJobId";
import { getPostgresPool, isPostgresConfigured } from "../db/postgres";
import { runWithAdvisoryLock, CoordinatorLockKey } from "./coordinatorLock";

/**
 * A run with no step progress for this long is treated as stranded. Conservative
 * by default — must exceed the longest single step (LLM / agent) to avoid
 * resurrecting a slow-but-alive run. Override via RUN_REAPER_STALE_MS.
 */
export const DEFAULT_REAPER_STALE_MS = 15 * 60_000;
/** Sweep cadence. Override via RUN_REAPER_INTERVAL_MS. */
export const DEFAULT_REAPER_INTERVAL_MS = 60_000;
/** Resume at most this many times before failing the run. Override via RUN_REAPER_MAX_ATTEMPTS. */
export const DEFAULT_REAPER_MAX_ATTEMPTS = 3;
/** Per-sweep cap so one tick can't enqueue unbounded work. */
const REAP_LIMIT = 50;

interface StrandedRunRow {
  id: string;
  workspace_id: string | null;
  workflow_version_id: string | null;
  external_template_id: string | null;
  resume_attempts: number;
}

export interface ReapResult {
  scanned: number;
  resumed: number;
  failed: number;
}

/**
 * Reap stranded `running` runs once. Pure of timers/singletons — takes the pool +
 * queue so it's unit-testable with fakes.
 */
export async function reapStrandedRuns(params: {
  pool: Pool;
  runQueue: Queue<RunJobPayload> | null;
  staleMs?: number;
  maxAttempts?: number;
  limit?: number;
}): Promise<ReapResult> {
  const { pool, runQueue } = params;
  const staleMs = params.staleMs ?? DEFAULT_REAPER_STALE_MS;
  const maxAttempts = params.maxAttempts ?? DEFAULT_REAPER_MAX_ATTEMPTS;
  const limit = params.limit ?? REAP_LIMIT;

  const { rows } = await pool.query<StrandedRunRow>(
    `SELECT r.id::text AS id, r.workspace_id::text AS workspace_id,
            r.workflow_version_id::text AS workflow_version_id,
            w.external_template_id, r.resume_attempts
       FROM runs r
       JOIN workflow_versions v ON v.id = r.workflow_version_id
       JOIN workflows w ON w.id = v.workflow_id
      WHERE r.status = 'running'
        AND r.updated_at < now() - ($1::bigint * interval '1 millisecond')
      ORDER BY r.updated_at ASC
      LIMIT $2`,
    [staleMs, limit],
  );

  let resumed = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.resume_attempts >= maxAttempts) {
      // Poison run — stop resurrecting it. Guarded on still-`running` so a run
      // that progressed between the SELECT and here is left alone.
      const res = await pool.query(
        `UPDATE runs
            SET status = 'failed',
                failure_reason = $2,
                error = $2,
                failed_at = now(),
                ended_at = COALESCE(ended_at, now()),
                updated_at = now()
          WHERE id = $1::uuid AND status = 'running'`,
        [row.id, `Crash-resume gave up after ${maxAttempts} attempts`],
      );
      if ((res.rowCount ?? 0) > 0) failed += 1;
      continue;
    }

    const attempt = row.resume_attempts + 1;
    // Claim it: flip running → queued so `executeQueuedRun`'s status guard
    // admits the replay. Guarded on still-`running` so we never resurrect a run
    // that just legitimately changed state.
    const claim = await pool.query(
      `UPDATE runs
          SET status = 'queued', resume_attempts = $2, updated_at = now()
        WHERE id = $1::uuid AND status = 'running'`,
      [row.id, attempt],
    );
    if ((claim.rowCount ?? 0) === 0) {
      continue;
    }

    if (runQueue) {
      const payload: RunJobPayload = {
        runId: row.id,
        templateId: row.external_template_id ?? row.id,
        ...(row.workflow_version_id ? { workflowVersionId: row.workflow_version_id } : {}),
        workspaceId: row.workspace_id ?? "",
        // Replay from the top — HEL-696 idempotency skips completed steps.
        stepIndex: 0,
        idempotencyKey: `${row.id}:0:resume:${attempt}`,
      };
      try {
        await runQueue.add("run", payload, {
          jobId: `resume:${row.id}:${attempt}`,
          removeOnComplete: 100,
        });
      } catch (err) {
        if (!isJobIdAlreadyExists(err)) throw err;
      }
    }
    resumed += 1;
  }

  return { scanned: rows.length, resumed, failed };
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * One advisory-locked sweep (fleet-safe). No-op without Postgres. Reads
 * staleMs / maxAttempts from env so they're tunable without a code change.
 */
export async function runStrandedRunReaperSweep(): Promise<void> {
  await runWithAdvisoryLock(CoordinatorLockKey.strandedRunReaper, async () => {
    if (!isPostgresConfigured()) return;
    const result = await reapStrandedRuns({
      pool: getPostgresPool(),
      runQueue: getRunQueue(),
      staleMs: envInt("RUN_REAPER_STALE_MS", DEFAULT_REAPER_STALE_MS),
      maxAttempts: envInt("RUN_REAPER_MAX_ATTEMPTS", DEFAULT_REAPER_MAX_ATTEMPTS),
    });
    if (result.resumed > 0 || result.failed > 0) {
      console.log(
        `[reaper] stranded runs — resumed ${result.resumed}, failed ${result.failed} (scanned ${result.scanned})`,
      );
    }
  });
}

let reaperTimer: ReturnType<typeof setInterval> | undefined;

export function startStrandedRunReaper(intervalMs = envInt("RUN_REAPER_INTERVAL_MS", DEFAULT_REAPER_INTERVAL_MS)): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    void runStrandedRunReaperSweep().catch((err) =>
      console.error("[reaper] stranded-run sweep failed", err),
    );
  }, intervalMs);
  reaperTimer.unref?.();
}

export function stopStrandedRunReaper(): void {
  if (!reaperTimer) return;
  clearInterval(reaperTimer);
  reaperTimer = undefined;
}
