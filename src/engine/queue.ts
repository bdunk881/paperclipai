/**
 * Simple async job queue for workflow runs.
 *
 * Execution is still in-process, but queue state is persisted to PostgreSQL
 * when DATABASE_URL is configured so queued/running/failed jobs survive
 * process restarts at the metadata layer.
 */

import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";

export interface RunJob {
  runId: string;
  templateId: string;
  attempt: number;
}

type JobHandler = (job: RunJob) => Promise<void>;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

/** Per-templateId promise chains so runs for the same template are serialised */
const chains = new Map<string, Promise<void>>();

/** Registered handler invoked for each job */
let handler: JobHandler | null = null;

async function persistJobState(
  job: RunJob,
  status: "queued" | "running" | "retrying" | "completed" | "failed",
  error?: unknown
): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    return;
  }

  const pool = getPostgresPool();
  await pool.query(
    `
      INSERT INTO workflow_queue_jobs (
        run_id, template_id, attempt, status, error, started_at, completed_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        CASE WHEN $4 IN ('running', 'retrying') THEN now() ELSE NULL END,
        CASE WHEN $4 IN ('completed', 'failed') THEN now() ELSE NULL END,
        now()
      )
      ON CONFLICT (run_id, attempt) DO UPDATE
      SET status = EXCLUDED.status,
          error = EXCLUDED.error,
          started_at = CASE
            WHEN EXCLUDED.status IN ('running', 'retrying') AND workflow_queue_jobs.started_at IS NULL THEN now()
            ELSE workflow_queue_jobs.started_at
          END,
          completed_at = CASE
            WHEN EXCLUDED.status IN ('completed', 'failed') THEN now()
            ELSE workflow_queue_jobs.completed_at
          END,
          updated_at = now()
    `,
    [
      job.runId,
      job.templateId,
      job.attempt,
      status,
      error ? String(error) : null,
    ]
  );
}

/** Register the function that processes a job (call once at startup). */
export function registerJobHandler(fn: JobHandler): void {
  handler = fn;
}

/** Add a job to the queue and return immediately. */
export function enqueue(job: Omit<RunJob, "attempt">): void {
  const fullJob: RunJob = { ...job, attempt: 1 };
  if (isPostgresPersistenceEnabled()) {
    void persistJobState(fullJob, "queued");
  }

  const prev = chains.get(job.templateId) ?? Promise.resolve();
  const next = prev.then(() => processWithRetry(fullJob));
  chains.set(job.templateId, next);
}

async function processWithRetry(job: RunJob): Promise<void> {
  if (!handler) {
    console.error("[queue] No job handler registered — dropping job", job.runId);
    if (isPostgresPersistenceEnabled()) {
      await persistJobState(job, "failed", "No job handler registered");
    }
    return;
  }

  try {
    if (isPostgresPersistenceEnabled()) {
      await persistJobState(job, "running");
    }
    await handler(job);
    if (isPostgresPersistenceEnabled()) {
      await persistJobState(job, "completed");
    }
  } catch (err) {
    if (job.attempt < MAX_RETRIES) {
      if (isPostgresPersistenceEnabled()) {
        await persistJobState(job, "retrying", err);
      }
      await sleep(RETRY_DELAY_MS * job.attempt);
      const nextAttempt: RunJob = { ...job, attempt: job.attempt + 1 };
      if (isPostgresPersistenceEnabled()) {
        await persistJobState(nextAttempt, "queued");
      }
      await processWithRetry(nextAttempt);
    } else {
      if (isPostgresPersistenceEnabled()) {
        await persistJobState(job, "failed", err);
      }
      console.error(
        `[queue] Job ${job.runId} failed after ${MAX_RETRIES} attempts:`,
        err
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns the number of active per-template chains (useful for health checks). */
export function activeChainCount(): number {
  return chains.size;
}
