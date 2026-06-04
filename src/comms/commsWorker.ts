/**
 * Durable comms-send worker (HEL-612). Consumes the `comms-send` queue and
 * delivers each job via the gateway with bounded retries: permanent failures
 * (4xx / config) don't retry, and a job that exhausts its retries is recorded
 * as failed and moved to the comms dead-letter queue (mirrors the runs worker
 * in `src/worker.ts`).
 *
 * `processCommsSendJob` is the per-attempt unit (exported for tests).
 * `startCommsWorker` wires the BullMQ Worker at boot — call it once from the
 * worker process. It is inert (returns null) without Redis, and no producer
 * enqueues yet, so it stays dormant until the gateway is adopted.
 */

import { Worker, Job } from "bullmq";
import { getRedisClient } from "../queue/redisClient";
import { commsGateway, CommsGateway } from "./gateway";
import { commsSendStore } from "./commsSendStore";
import { getCommsDlqQueue, CommsSendJobPayload } from "./commsQueue";
import { TransportError } from "./types";

/**
 * Run one delivery attempt for a queued send. Resolves on success or on a
 * permanent failure (recorded, no retry); throws on a retryable failure so
 * BullMQ retries the job.
 */
export async function processCommsSendJob(
  payload: CommsSendJobPayload,
  gateway: CommsGateway = commsGateway,
): Promise<void> {
  const row = await commsSendStore.findById(
    payload.workspaceId,
    payload.commsSendId,
    payload.userId,
  );
  if (!row) {
    return; // ledger row gone — nothing to deliver
  }
  if (row.status === "sent") {
    return; // already delivered — idempotent no-op on a duplicate/retry
  }

  try {
    await gateway.deliverExisting({
      id: payload.commsSendId,
      workspaceId: payload.workspaceId,
      kind: payload.kind,
      channel: payload.channel,
      message: payload.message,
      userId: payload.userId,
    });
  } catch (err) {
    const retryable = err instanceof TransportError ? err.retryable : true;
    const message = err instanceof Error ? err.message : String(err);
    if (retryable) {
      // Rethrow so BullMQ retries; the worker's failed handler DLQs + marks
      // failed once retries are exhausted.
      throw err instanceof Error ? err : new Error(message);
    }
    // Permanent failure — record and stop (no retry).
    await commsSendStore.markFailed(payload.workspaceId, payload.commsSendId, message, payload.userId);
  }
}

let _commsWorker: Worker<CommsSendJobPayload> | null = null;

/** Wire the BullMQ comms worker. No-op (returns null) when Redis is absent. */
export function startCommsWorker(): Worker<CommsSendJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (_commsWorker) return _commsWorker;

  const worker = new Worker<CommsSendJobPayload>(
    "comms-send",
    async (job: Job<CommsSendJobPayload>) => {
      await processCommsSendJob(job.data);
    },
    { connection, concurrency: 10 },
  );

  worker.on("failed", (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 5;
    if (attempts < maxAttempts) {
      return; // still retrying
    }
    const data = job?.data;
    if (!data) {
      return;
    }
    commsSendStore
      .markFailed(data.workspaceId, data.commsSendId, err.message.slice(0, 1000), data.userId)
      .catch((markErr: Error) => console.error("[worker:comms] markFailed failed:", markErr.message));

    const dlq = getCommsDlqQueue();
    dlq
      ?.add("dlq-entry", data, { removeOnComplete: 500, removeOnFail: 500 })
      .catch((dlqErr: Error) => console.error("[worker:comms] DLQ enqueue failed:", dlqErr.message));
  });

  _commsWorker = worker;
  return worker;
}

export function resetCommsWorkerForTests(): void {
  _commsWorker = null;
}
