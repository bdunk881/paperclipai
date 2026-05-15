/**
 * BullMQ worker process — durable run execution (HEL-106).
 *
 * Start with: node dist/worker.js
 * Requires REDIS_URL or UPSTASH_REDIS_URL to be set.
 *
 * Execution stub: logs the job and marks it complete.
 * Actual step execution is wired in HEL-107+.
 */

import { Worker, Job } from "bullmq";
import { getRedisClient } from "./queue/redisClient";
import type { RunJobPayload } from "./queue/queues";

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
  console.error(
    `[worker] Job ${job?.id ?? "unknown"} failed (run ${job?.data?.runId ?? "unknown"}):`,
    err.message
  );
});

worker.on("stalled", (jobId) => {
  console.warn(`[worker] Job ${jobId} stalled — will be re-queued`);
});

console.log("[worker] Started, listening on 'runs' queue");
