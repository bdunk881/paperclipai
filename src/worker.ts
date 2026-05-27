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
 *     queue. DAG run execution itself remains stubbed (HEL-107+).
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
import { syncRepeatableJobs } from "./queue/scheduler";
import { runStore } from "./engine/runStore";
import { getPostgresPool, isPostgresConfigured, isPostgresPersistenceEnabled } from "./db/postgres";
import { executeAgentPrompt } from "./agents/agentPromptExecution";
import {
  startPlanApprovalResumeCoordinator,
  stopPlanApprovalResumeCoordinator,
} from "./agents/runtime/planApprovalResumeCoordinator";

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
    // Existing workflow-run dispatch path — stub until HEL-107+.
    console.log(
      `[worker] Received run ${data.runId} step ${data.stepIndex} (template: ${data.templateId})`,
    );
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
    await executeAgentPrompt({
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
    });
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
  await Promise.all([runsWorker.close(), agentPromptWorker.close()]);
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

console.log("[worker] Started, listening on 'runs' + 'agent-prompt' queues");
