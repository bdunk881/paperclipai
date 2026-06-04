/**
 * Durable comms-send queue (HEL-612). Mirrors the singleton-or-null pattern in
 * `src/queue/queues.ts` and `src/queue/storageQueue.ts`: when Redis is
 * unavailable (tests / local dev) the queue is null and `enqueueCommsSend`
 * falls back to a synchronous `gateway.send` so the call still completes.
 */

import { Queue } from "bullmq";
import { getRedisClient } from "../queue/redisClient";
import { commsGateway, CommsGateway } from "./gateway";
import { commsSendStore } from "./commsSendStore";
import { CommsChannel, CommsKind, CommsSendInput, CommsSendResult, TransportMessage } from "./types";

/** BullMQ job payload: the ledger row id + the message content to deliver. */
export interface CommsSendJobPayload {
  commsSendId: string;
  workspaceId: string;
  userId?: string;
  agentId?: string;
  missionId?: string;
  kind: CommsKind;
  channel: CommsChannel;
  message: TransportMessage;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

let _commsQueue: Queue<CommsSendJobPayload> | null = null;

/** Singleton comms-send queue, or null when Redis is unavailable. */
export function getCommsQueue(): Queue<CommsSendJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_commsQueue) {
    _commsQueue = new Queue<CommsSendJobPayload>("comms-send", {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _commsQueue;
}

export function resetCommsQueueForTests(): void {
  _commsQueue = null;
}

let _commsDlqQueue: Queue<CommsSendJobPayload> | null = null;

/** Singleton comms dead-letter queue, or null when Redis is unavailable. */
export function getCommsDlqQueue(): Queue<CommsSendJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_commsDlqQueue) {
    _commsDlqQueue = new Queue<CommsSendJobPayload>("comms-send-dlq", { connection });
  }
  return _commsDlqQueue;
}

export function resetCommsDlqQueueForTests(): void {
  _commsDlqQueue = null;
}

/** Deterministic, colon-free BullMQ jobId so duplicate enqueues dedupe. */
function jobIdFor(workspaceId: string, idempotencyKey: string): string {
  return `comms-${workspaceId}-${idempotencyKey}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Durably enqueue a send. With Redis: records the queued ledger row (dedup on
 * `idempotencyKey`) and adds a BullMQ job carrying the message; the worker
 * delivers with bounded retries → DLQ. Without Redis: falls back to a
 * synchronous `gateway.send` so dev/test still deliver.
 */
export async function enqueueCommsSend(
  input: CommsSendInput,
  opts: { gateway?: CommsGateway } = {},
): Promise<CommsSendResult> {
  const gateway = opts.gateway ?? commsGateway;
  const queue = getCommsQueue();
  if (!queue) {
    return gateway.send(input);
  }

  const { record, created } = await commsSendStore.insertQueued({
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentId: input.agentId,
    missionId: input.missionId,
    kind: input.kind,
    channel: input.channel,
    to: input.to,
    idempotencyKey: input.idempotencyKey,
    template: input.template,
  });
  if (!created) {
    return {
      id: record.id,
      status: record.status,
      deduped: true,
      provider: record.provider,
      providerMessageId: record.providerMessageId,
      error: record.error,
    };
  }

  const payload: CommsSendJobPayload = {
    commsSendId: record.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentId: input.agentId,
    missionId: input.missionId,
    kind: input.kind,
    channel: input.channel,
    message: {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      vars: input.vars,
    },
  };
  await queue.add("comms-send", payload, {
    jobId: jobIdFor(input.workspaceId, input.idempotencyKey),
  });

  return { id: record.id, status: "queued", deduped: false, provider: record.provider };
}
