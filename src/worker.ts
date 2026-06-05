/**
 * BullMQ worker process — durable run execution (HEL-106).
 *
 * Start with: node dist/worker.js
 * Requires REDIS_URL or UPSTASH_REDIS_URL to be set.
 *
 * On startup, syncRepeatableJobs() reconciles BullMQ job schedulers against
 * the routines table so cron schedules survive process restarts (HEL-108).
 *
 * Two BullMQ queues consumed here:
 *   - "runs" — workflow/DAG runs + cron-fired routine job-schedulers.
 *     For cron fires of prompt-backed routines (HEL-174), the scheduler
 *     enqueues a job whose idempotencyKey starts with "scheduler:";
 *     this worker looks up the routine and dispatches to the agent-prompt
 *     queue. Non-cron DAG run jobs are driven through
 *     `workflowEngine.executeQueuedRun` (HEL-478).
 *   - "agent-prompt" — ad-hoc + cron-fired agent NL execution
 *     (HEL-174). The worker calls `executeAgentPrompt` and persists
 *     results to the `runs` table + ticket updates + activity feed.
 */

// DASH-29: Sentry instrument MUST load first — same reasoning as
// src/index.ts. The worker process emits Sentry events for queue
// failures, retry exhaustion, etc. None of those events shipped
// before this import was added.
import "./instrument";

import * as Sentry from "@sentry/node";
import { Worker, Job, MetricsTime } from "bullmq";
import {
  buildRoutineCronAgentPromptJobId,
  isJobIdAlreadyExists,
} from "./queue/bullMqJobId";
import { getRedisClient } from "./queue/redisClient";
import type { RunJobPayload, AgentPromptJobPayload } from "./queue/queues";
import { getDlqQueue, getAgentPromptQueue, getRunQueue } from "./queue/queues";
import type { StorageDeletionPayload } from "./queue/storageQueue";
import { getStorageAdapter, parseStorageKey } from "./storage";
import { syncRepeatableJobs } from "./queue/scheduler";
import { runStore } from "./engine/runStore";
import { getPostgresPool, isPostgresConfigured, isPostgresPersistenceEnabled } from "./db/postgres";
import { executeAgentPrompt } from "./agents/agentPromptExecution";
import { setActedRunId } from "./agents/wakeEventStore";
import {
  startPlanApprovalResumeCoordinator,
  stopPlanApprovalResumeCoordinator,
} from "./agents/runtime/planApprovalResumeCoordinator";
import { startDlqDepthMonitor } from "./queue/dlqMonitor";

const redisConnection = getRedisClient();
if (!redisConnection) {
  console.error(
    "[worker] REDIS_URL or UPSTASH_REDIS_URL must be set. Exiting."
  );
  process.exit(1);
}
const connection = redisConnection;

/**
 * HEL-174: when the "runs" cron scheduler fires for a routine, the job
 * idempotency key is `scheduler:<routineId>` and the rest of the
 * payload is empty. Look up the routine — if it's prompt-backed,
 * enqueue it onto the agent-prompt queue with the resolved fields.
 * Workflow-backed routines fall through to the existing stub for
 * HEL-107+ to wire.
 */
async function handleRunsJob(data: RunJobPayload): Promise<void> {
  const isCronFire =
    data.idempotencyKey?.startsWith("scheduler:") && !data.runId && !data.templateId;
  if (!isCronFire) {
    // HEL-478: execute a queued workflow DAG run. POST /api/runs (and
    // /retry, /replay-with-latest, /replay-from-step) create the run row
    // with status "queued" and enqueue here; drive it through the engine.
    // `data.stepIndex` is 0 for fresh/retry/replay-latest and N>0 for
    // replay-from-step (resume on top of the cloned prefix). executeQueuedRun
    // is idempotent (skips any run already past "queued"/"pending") so a
    // BullMQ retry never double-runs side-effecting steps.
    if (!data.runId) {
      console.warn(
        `[worker] runs job missing runId; ignoring (idempotencyKey=${data.idempotencyKey})`,
      );
      return;
    }
    // Lazy import: WorkflowEngine statically pulls the llmProviders barrel
    // (→ ESM-only @mistralai/mistralai), which breaks module-eval in jest.
    // Deferring the load keeps worker boot — and worker.test.ts's import-time
    // smoke test — off that chain, mirroring the HEL-492 lazy-import fix.
    const { workflowEngine } = await import("./engine/WorkflowEngine");
    await workflowEngine.executeQueuedRun(data.runId, data.stepIndex ?? 0);
    return;
  }
  const routineId = data.idempotencyKey.slice("scheduler:".length);
  if (!isPostgresConfigured()) {
    console.warn(`[worker] cron fire for routine ${routineId} skipped — Postgres unavailable`);
    return;
  }
  const pool = getPostgresPool();
  const routineResult = await pool.query<{
    id: string;
    workspace_id: string;
    agent_id: string | null;
    prompt: string | null;
    system_prompt: string | null;
    llm_tier: "lite" | "standard" | "power" | null;
    workflow_id: string | null;
    enabled: boolean;
  }>(
    `SELECT id::text, workspace_id::text, agent_id::text, prompt, system_prompt,
            llm_tier, workflow_id::text, enabled
       FROM routines
      WHERE id = $1::uuid`,
    [routineId],
  );
  const routine = routineResult.rows[0];
  if (!routine || !routine.enabled) {
    console.log(`[worker] cron fire ignored — routine ${routineId} missing or disabled`);
    return;
  }
  if (routine.prompt && routine.agent_id) {
    // HEL-507: scheduled cron fires are unattended, so they run in "auto"
    // (no HITL plan gate). permissionMode is threaded through both the queued
    // dispatch and the inline fallback so the value is preserved end-to-end —
    // a non-cron enqueuer's "plan" would otherwise be silently dropped on the
    // fallback path and skip the approval gate.
    const schedulePermissionMode = "auto" as const;
    const agentPromptQueue = getAgentPromptQueue();
    if (!agentPromptQueue) {
      console.warn(
        `[worker] agent-prompt queue unavailable; dispatching cron fire inline for routine ${routineId}`,
      );
      // Best-effort inline dispatch — fall back to direct execution. We
      // need a userId for `runAgentTurn`'s llmConfigStore lookup; use
      // the agent's owning user (the agent_id row carries it).
      const agentResult = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM agents WHERE id = $1::uuid`,
        [routine.agent_id],
      );
      const userId = agentResult.rows[0]?.user_id;
      if (!userId) {
        console.warn(`[worker] cron fire missing agent owner for routine ${routineId}`);
        return;
      }
      await executeAgentPrompt({
        pool,
        workspaceId: routine.workspace_id,
        userId,
        agentId: routine.agent_id,
        prompt: routine.prompt,
        systemPrompt: routine.system_prompt ?? undefined,
        llmTier: routine.llm_tier ?? "standard",
        sourceRoutineId: routine.id,
        triggerKind: "schedule",
        permissionMode: schedulePermissionMode,
      });
      return;
    }
    const agentResult = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM agents WHERE id = $1::uuid`,
      [routine.agent_id],
    );
    const userId = agentResult.rows[0]?.user_id;
    if (!userId) {
      console.warn(`[worker] cron fire missing agent owner for routine ${routineId}`);
      return;
    }
    const firedAtMs = Date.now();
    const jobId = buildRoutineCronAgentPromptJobId(routine.id, firedAtMs);
    try {
      await agentPromptQueue.add(
        "schedule",
        {
          workspaceId: routine.workspace_id,
          userId,
          agentId: routine.agent_id,
          prompt: routine.prompt,
          systemPrompt: routine.system_prompt ?? undefined,
          llmTier: routine.llm_tier ?? "standard",
          sourceRoutineId: routine.id,
          triggerKind: "schedule",
          permissionMode: schedulePermissionMode,
          idempotencyKey: `routine-cron:${routine.id}:${firedAtMs}`,
        },
        { jobId },
      );
    } catch (err) {
      if (isJobIdAlreadyExists(err)) {
        return;
      }
      throw err;
    }
    return;
  }
  console.log(
    `[worker] cron fire for workflow-backed routine ${routineId} — DAG dispatch stub (HEL-107+)`,
  );
}

const runQueue = getRunQueue();
if (!runQueue) {
  console.error("[worker] Run queue unavailable despite Redis connection. Exiting.");
  process.exit(1);
}

const runsWorker = new Worker<RunJobPayload>(
  "runs",
  async (job: Job<RunJobPayload>) => {
    await handleRunsJob(job.data);
  },
  {
    connection,
    concurrency: 5,
    // HEL infra dashboard PR #3: keep 24h of one-minute throughput buckets so
    // the custom queue inspector can render a sparkline. Cheap (1440 keys).
    metrics: { maxDataPoints: MetricsTime.ONE_HOUR * 24 },
  }
);

runsWorker.on("completed", (job) => {
  console.log(`[worker:runs] Job ${job.id} completed (run ${job.data.runId})`);
});

runsWorker.on("failed", (job, err) => {
  const runId = job?.data?.runId ?? "unknown";
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 3;
  console.error(`[worker:runs] Job ${job?.id ?? "unknown"} failed (run ${runId}):`, err.message);

  // Only send to DLQ after all retries are exhausted.
  if (attempts < maxAttempts) return;

  const reason = err.message.slice(0, 1000);

  if (runId !== "unknown" && runId) {
    runStore.markFailed(runId, reason).catch((markErr: Error) => {
      console.error("[worker:runs] markFailed failed:", markErr.message);
    });
  }

  const dlq = getDlqQueue();
  if (dlq && job?.data) {
    dlq.add("dlq-entry", job.data, { removeOnComplete: 500, removeOnFail: 500 }).catch((dlqErr: Error) => {
      console.error("[worker:runs] DLQ enqueue failed:", dlqErr.message);
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
      console.error("[worker:runs] activity_events insert failed:", dbErr.message);
    });
  }
});

runsWorker.on("stalled", (jobId) => {
  console.warn(`[worker:runs] Job ${jobId} stalled — will be re-queued`);
});

/**
 * HEL-174: agent-prompt queue consumer. Each job carries a fully
 * resolved agent + prompt; dispatch through `executeAgentPrompt`.
 */
const agentPromptWorker = new Worker<AgentPromptJobPayload>(
  "agent-prompt",
  async (job: Job<AgentPromptJobPayload>) => {
    if (!isPostgresConfigured()) {
      console.warn("[worker:agent-prompt] Postgres unavailable; skipping job");
      return;
    }
    const pool = getPostgresPool();
    const { runId } = await executeAgentPrompt({
      pool,
      workspaceId: job.data.workspaceId,
      userId: job.data.userId,
      agentId: job.data.agentId,
      prompt: job.data.prompt,
      systemPrompt: job.data.systemPrompt,
      llmTier: job.data.llmTier,
      sourceTicketId: job.data.sourceTicketId,
      sourceRoutineId: job.data.sourceRoutineId,
      triggerKind: job.data.triggerKind,
      permissionMode: job.data.permissionMode,
    });
    // HEL-613: link an ACTed wake event to the run it spawned.
    if (job.data.wakeEventId) {
      await setActedRunId(pool, {
        eventId: job.data.wakeEventId,
        workspaceId: job.data.workspaceId,
        userId: job.data.userId,
        runId,
      }).catch((err: Error) => {
        console.error(
          `[worker:agent-prompt] acted_run_id backfill failed for wake ${job.data.wakeEventId}: ${err.message}`,
        );
      });
    }
  },
  {
    connection,
    concurrency: 3,
    metrics: { maxDataPoints: MetricsTime.ONE_HOUR * 24 },
  }
);

agentPromptWorker.on("completed", (job) => {
  console.log(
    `[worker:agent-prompt] Job ${job.id} completed (agent ${job.data.agentId} ${job.data.triggerKind})`,
  );
});

agentPromptWorker.on("failed", (job, err) => {
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 3;
  console.error(
    `[worker:agent-prompt] Job ${job?.id ?? "unknown"} failed for agent ${job?.data?.agentId ?? "unknown"}:`,
    err.message,
  );
  if (attempts < maxAttempts) {
    return;
  }
  const reason = err.message.slice(0, 1000);
  Sentry.captureException(err, {
    tags: {
      queue: "agent-prompt",
      triggerKind: job?.data?.triggerKind ?? "unknown",
    },
    contexts: {
      agent_prompt: {
        jobId: job?.id,
        agentId: job?.data?.agentId,
        workspaceId: job?.data?.workspaceId,
        sourceTicketId: job?.data?.sourceTicketId,
        sourceRoutineId: job?.data?.sourceRoutineId,
        error: reason,
      },
    },
  });
  if (isPostgresPersistenceEnabled() && job?.data?.workspaceId) {
    const pool = getPostgresPool();
    const subjectId = job.data.sourceTicketId ?? job.data.sourceRoutineId ?? job.data.agentId;
    pool
      .query(
        `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload, occurred_at)
         VALUES ($1::uuid, 'agent.prompt.failed', $2::jsonb, $3::jsonb, $4::jsonb, now())`,
        [
          job.data.workspaceId,
          JSON.stringify({ type: "system", id: "worker", label: "Worker" }),
          JSON.stringify({
            type: job.data.sourceTicketId ? "ticket" : "agent",
            id: subjectId,
            label: subjectId,
          }),
          JSON.stringify({
            agentId: job.data.agentId,
            triggerKind: job.data.triggerKind,
            error: reason,
          }),
        ],
      )
      .catch((dbErr: Error) => {
        console.error("[worker:agent-prompt] activity_events insert failed:", dbErr.message);
      });
  }
});

/**
 * HEL-354: storage object-deletion queue consumer. The DELETE /api/files/:id
 * route soft-deletes the row and enqueues the bucket-object removal here so a
 * slow/failing provider call never blocks the request. HEL-356 reuses this
 * queue for bulk workspace-deletion cleanup.
 */
const storageDeletionWorker = new Worker<StorageDeletionPayload>(
  "storage-deletion",
  async (job: Job<StorageDeletionPayload>) => {
    const ref = parseStorageKey(job.data.storageKey);
    if (!ref) {
      console.warn(
        `[worker:storage-deletion] malformed storage_key for file ${job.data.fileId}; skipping`,
      );
      return;
    }
    await getStorageAdapter().deleteObject(ref);
  },
  {
    connection,
    concurrency: 5,
    metrics: { maxDataPoints: MetricsTime.ONE_HOUR * 24 },
  },
);

storageDeletionWorker.on("completed", (job) => {
  console.log(`[worker:storage-deletion] deleted object for file ${job.data.fileId}`);
});

storageDeletionWorker.on("failed", (job, err) => {
  console.error(
    `[worker:storage-deletion] Job ${job?.id ?? "unknown"} failed (file ${job?.data?.fileId ?? "unknown"}):`,
    err.message,
  );
  const attempts = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 5;
  if (attempts < maxAttempts) return;
  Sentry.captureException(err, {
    tags: { queue: "storage-deletion" },
    contexts: {
      storage_deletion: {
        jobId: job?.id,
        fileId: job?.data?.fileId,
        workspaceId: job?.data?.workspaceId,
      },
    },
  });
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

async function shutdownWorker(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received — closing queues`);
  stopPlanApprovalResumeCoordinator();
  await Promise.all([runsWorker.close(), agentPromptWorker.close(), storageDeletionWorker.close()]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdownWorker("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdownWorker("SIGINT");
});

// HEL-216: kick off the plan-approval resume sweep. When a customer
// approves a plan-mode agent's plan, this is what notices the
// `approval_requests` row flipping to resolved and replays the agent
// with permissionMode: 'auto'. Skipped silently when Postgres isn't
// configured (in-memory dev / tests) — the sweep is a no-op there.
startPlanApprovalResumeCoordinator();

// HEL-490: runs-dlq has no drain consumer (by design — retry-exhausted jobs
// shouldn't auto-replay). Monitor its depth and Sentry-alert when it grows, so
// an operator drains it via the admin-console manual replay. No-op without Redis.
startDlqDepthMonitor();

console.log("[worker] Started, listening on 'runs' + 'agent-prompt' + 'storage-deletion' queues");
