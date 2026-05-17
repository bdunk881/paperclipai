import { Queue } from "bullmq";
import { getRedisClient } from "./redisClient";

export interface RunJobPayload {
  runId: string;
  templateId: string;
  workflowVersionId?: string;
  workspaceId: string;
  stepIndex: number;
  idempotencyKey: string;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};

let _runQueue: Queue<RunJobPayload> | null = null;

/**
 * Returns the singleton BullMQ Queue for workflow runs.
 * Returns null when Redis is not configured (tests, local dev without Redis).
 */
export function getRunQueue(): Queue<RunJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_runQueue) {
    _runQueue = new Queue<RunJobPayload>("runs", {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _runQueue;
}

export function resetRunQueueForTests(): void {
  _runQueue = null;
}
