import { Job, JobsOptions, Queue } from "bullmq";
import { getRedisClient } from "./redisClient";
import type { RunPriority } from "../types/workflow";

/**
 * HEL-700: run priority. Ordered fastest→slowest; mapped to a BullMQ numeric
 * priority where a LOWER number is dequeued first. Every run job is assigned a
 * positive priority (default `normal`) via {@link addRunJob}, so ordering is
 * fully determined by these values and never depends on BullMQ's mixed
 * prioritized/un-prioritized behavior. `normal` runs keep FIFO order among
 * themselves; `critical`/`high` jump ahead, `low` trails.
 */
export type { RunPriority };

const RUN_PRIORITY_VALUES: Record<RunPriority, number> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export const DEFAULT_RUN_PRIORITY: RunPriority = "normal";

export function isRunPriority(value: unknown): value is RunPriority {
  return value === "critical" || value === "high" || value === "normal" || value === "low";
}

/** Maps a run priority (default `normal`) to its BullMQ numeric priority. */
export function resolveRunPriority(priority?: RunPriority): number {
  return RUN_PRIORITY_VALUES[priority ?? DEFAULT_RUN_PRIORITY];
}

export interface RunJobPayload {
  runId: string;
  templateId: string;
  workflowVersionId?: string;
  workspaceId: string;
  stepIndex: number;
  idempotencyKey: string;
  /**
   * HEL-700: queue priority. Travels on the payload so it survives re-enqueues
   * (resume after a wait, manual retry, crash-resume). Absent ⇒ `normal`.
   */
  priority?: RunPriority;
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
  triggerKind: "assignment" | "assignment_update" | "schedule" | "manual" | "wake";
  /**
   * HEL-613: when this job was dispatched by a wake-event ACT decision, the
   * originating wake_events row id. The worker backfills `acted_run_id` on
   * that row once executeAgentPrompt returns the run id.
   */
  wakeEventId?: string;
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

/**
 * HEL-700: enqueue a run job with its BullMQ priority derived from
 * `payload.priority` (default `normal`). Use this everywhere instead of
 * `runQueue.add(...)` so every run job carries a deterministic priority and
 * `critical`/`high` runs jump the queue. The caller's `opts` win for every
 * other option (jobId, delay, removeOnComplete, …); only `priority` is set here.
 */
export function addRunJob(
  queue: Queue<RunJobPayload>,
  name: string,
  payload: RunJobPayload,
  opts: JobsOptions = {},
): Promise<Job<RunJobPayload>> {
  return queue.add(name, payload, { ...opts, priority: resolveRunPriority(payload.priority) });
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
