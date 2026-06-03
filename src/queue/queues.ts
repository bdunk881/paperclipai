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

/**
 * HEL-174: payload for agent NL-prompt execution jobs. Used by the
 * three trigger paths — ticket-created, ticket-update, manual
 * "Run agent" — to dispatch through the worker. Scheduled prompt
 * routines reuse this payload from the worker's `runs` cron handler
 * once it identifies a prompt-backed routine.
 */
export interface AgentPromptJobPayload {
  workspaceId: string;
  userId: string;
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  llmTier?: "lite" | "standard" | "power";
  sourceTicketId?: string;
  sourceRoutineId?: string;
  triggerKind: "assignment" | "assignment_update" | "schedule" | "manual";
  /**
   * HEL-507: permission mode forwarded to `executeAgentPrompt`. "plan"
   * makes the agent stop for HITL approval. Must travel on the payload so
   * a plan-mode job keeps its approval gate across the queue round-trip
   * (and the worker's inline fallback). Omitted ⇒ executeAgentPrompt's
   * default ("auto").
   */
  permissionMode?: "auto" | "plan" | "review";
  /**
   * Logical idempotency key stored in job payload (may contain `:`).
   * BullMQ dedupe uses a separate colon-free `jobId` from bullMqJobId.ts.
   */
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

let _dlqQueue: Queue<RunJobPayload> | null = null;

/**
 * Returns the singleton BullMQ Queue for failed runs (dead-letter queue).
 * Returns null when Redis is not configured (tests, local dev without Redis).
 */
export function getDlqQueue(): Queue<RunJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_dlqQueue) {
    _dlqQueue = new Queue<RunJobPayload>("runs-dlq", { connection });
  }
  return _dlqQueue;
}

export function resetDlqQueueForTests(): void {
  _dlqQueue = null;
}

let _agentPromptQueue: Queue<AgentPromptJobPayload> | null = null;

/**
 * HEL-174: Singleton BullMQ Queue for ad-hoc + cron-fired agent NL
 * prompt execution. Worker picks these up and dispatches to
 * `executeAgentPrompt`. Returns null when Redis is unavailable so
 * test contexts can call directly through the primitive without a
 * queue round-trip.
 */
export function getAgentPromptQueue(): Queue<AgentPromptJobPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_agentPromptQueue) {
    _agentPromptQueue = new Queue<AgentPromptJobPayload>("agent-prompt", {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _agentPromptQueue;
}

export function resetAgentPromptQueueForTests(): void {
  _agentPromptQueue = null;
}
