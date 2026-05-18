/**
 * BullMQ worker process — durable run execution (HEL-106).
 *
 * Start with: node dist/worker.js
 * Requires REDIS_URL or UPSTASH_REDIS_URL to be set.
 *
 * On startup, syncRepeatableJobs() reconciles BullMQ job schedulers against
 * the routines table so cron schedules survive process restarts (HEL-108).
 *
 * Execution stub: logs the job and marks it complete.
 * Actual step execution is wired in HEL-107+.
 */

// DASH-29: Sentry instrument MUST load first — same reasoning as
// src/index.ts. The worker process emits Sentry events for queue
// failures, retry exhaustion, etc. None of those events shipped
// before this import was added.
import "./instrument";

import { Worker, Job, Queue } from "bullmq";
import { getRedisClient } from "./queue/redisClient";
import type { RunJobPayload } from "./queue/queues";
import { getDlqQueue } from "./queue/queues";
import { syncRepeatableJobs } from "./queue/scheduler";
import { runStore } from "./engine/runStore";
import { getPostgresPool, isPostgresConfigured, isPostgresPersistenceEnabled } from "./db/postgres";

const connection = getRedisClient();
if (!connection) {
  console.error(
    "[worker] REDIS_URL or UPSTASH_REDIS_URL must be set. Exiting."
  );
  process.exit(1);
}

async function executeStep(data: RunJobPayload): Promise<void> {
  // Stub: actual execution wired in HEL-107+
  console.log(
    `[worker] Received run ${data.runId} step ${data.stepIndex} (template: ${data.templateId})`
  );
}

const runQueue = new Queue<RunJobPayload>("runs", { connection });

const worker = new Worker<RunJobPayload>(
  "runs",
  async (job: Job<RunJobPayload>) => {
    await executeStep(job.data);
  },
  { connection, concurrency: 5 }
);

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed (run ${job.data.runId})`);
});

worker.on("failed", (job, err) => {
  const runId = job?.data?.runId ?? "unknown";
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 3;
  console.error(`[worker] Job ${job?.id ?? "unknown"} failed (run ${runId}):`, err.message);

  // Only send to DLQ after all retries are exhausted.
  if (attempts < maxAttempts) return;

  const reason = err.message.slice(0, 1000);

  runStore.markFailed(runId, reason).catch((markErr: Error) => {
    console.error("[worker] markFailed failed:", markErr.message);
  });

  const dlq = getDlqQueue();
  if (dlq && job?.data) {
    dlq.add("dlq-entry", job.data, { removeOnComplete: 500, removeOnFail: 500 }).catch((dlqErr: Error) => {
      console.error("[worker] DLQ enqueue failed:", dlqErr.message);
    });
  }

  if (isPostgresPersistenceEnabled()) {
    const pool = getPostgresPool();
    pool.query(
      `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload, occurred_at)
       VALUES ($1::uuid, 'run.failed', $2::jsonb, $3::jsonb, $4::jsonb, now())`,
      [
        job?.data?.workspaceId ?? null,
        JSON.stringify({ type: "system", id: "worker", label: "Worker" }),
        JSON.stringify({ type: "execution", id: runId, label: runId }),
        JSON.stringify({ runId, error: reason }),
      ]
    ).catch((dbErr: Error) => {
      console.error("[worker] activity_events insert failed:", dbErr.message);
    });
  }
});

worker.on("stalled", (jobId) => {
  console.warn(`[worker] Job ${jobId} stalled — will be re-queued`);
});

// Sync cron schedules after a short delay to let the DB connection warm up.
if (isPostgresConfigured()) {
  const pool = getPostgresPool();
  setTimeout(() => {
    syncRepeatableJobs(runQueue, pool).catch((err: Error) => {
      console.error("[worker] syncRepeatableJobs failed:", err.message);
    });
  }, 2000);
}

console.log("[worker] Started, listening on 'runs' queue");
