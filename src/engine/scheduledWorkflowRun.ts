/**
 * Scheduled workflow-backed routine dispatch (HEL-665, Phase 0).
 *
 * The BullMQ "runs" cron handler (`src/worker.ts`) fires once per schedule with
 * idempotencyKey `scheduler:<routineId>`. Prompt-backed routines dispatch to the
 * agent-prompt queue; **workflow-backed** routines (a `workflow_id`, no `prompt`)
 * used to hit a `console.log` stub and never run. This is the wire-up: on cron
 * fire we resolve the routine's workflow into a runnable DAG, create a `queued`
 * run, and enqueue it back onto the "runs" queue so the existing
 * {@link WorkflowEngine.executeQueuedRun} path (with its per-run idempotency
 * guard + retry/DLQ) executes it — exactly what `POST /api/runs` does, but
 * sourced from a cron tick instead of an HTTP request.
 *
 * Tenancy: the DAG is loaded scoped to the routine's workspace, and the run is
 * tagged with that workspace + the routine's agent owner as `userId`. The worker
 * runs sessionless (service role), mirroring the sibling prompt cron path which
 * also reads `routines` / `agents` directly with the pool.
 *
 * Extracted from the worker so it is unit-testable against the in-memory
 * `runStore` + a fake queue.
 */

import { createHash } from "crypto";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import type { RunJobPayload } from "../queue/queues";
import { addRunJob } from "../queue/queues";
import { isJobIdAlreadyExists } from "../queue/bullMqJobId";
import { parseJsonColumn } from "../db/json";
import type { WorkflowTemplate } from "../types/workflow";
import { runStore } from "./runStore";

/** The subset of a routine row this dispatcher needs. */
export interface ScheduledWorkflowRoutine {
  id: string;
  workspace_id: string;
  /** `workflows.id` (FK) — the DAG to run. */
  workflow_id: string;
  /** Always set on a routine; attributes the run to an owning user. */
  agent_id: string | null;
  /**
   * HEL-821: which environment's deployed version this routine runs. Absent ⇒
   * 'dev'. Resolution picks that env's current deployment, falling back to the
   * workflow's latest version when the env has no deployment yet.
   */
  environment?: string;
}

export type DispatchScheduledWorkflowResult =
  | { status: "enqueued"; runId: string }
  | { status: "skipped"; reason: string };

/**
 * Deterministic, RFC-4122-shaped run id derived from a stable seed (the cron
 * fire's BullMQ job id). A retry of the *same* scheduler job re-derives the same
 * id, so we reuse the existing run row instead of creating a duplicate. Built
 * with `crypto` (no `uuid` dependency — `uuid` is ESM-only and never imported
 * elsewhere in `src/`).
 */
export function deterministicScheduledRunId(seed: string): string {
  const hex = createHash("sha256").update(`scheduled-workflow:${seed}`).digest("hex");
  const c = hex.slice(0, 32).split("");
  c[12] = "5"; // version nibble → 5 (name-based)
  c[16] = ((parseInt(c[16]!, 16) & 0x3) | 0x8).toString(16); // variant → 10xx
  const s = c.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

interface WorkflowVersionRow {
  version_id: string;
  dag: unknown;
  external_template_id: string | null;
  workflow_name: string | null;
}

/**
 * Resolve a workflow-backed routine's latest DAG, create a `queued` run, and
 * enqueue it onto the "runs" queue. Returns `skipped` (a no-op, not an error)
 * when the routine's workflow has no runnable latest version — the honest
 * outcome when there is nothing to fire.
 */
export async function dispatchScheduledWorkflowRun(params: {
  pool: Pool;
  runQueue: Queue<RunJobPayload>;
  routine: ScheduledWorkflowRoutine;
  /** The BullMQ scheduler job id for this fire (idempotency seed). */
  jobId?: string;
  /**
   * Extra run input merged over the default `{ workspaceId }`. Cron fires pass
   * nothing; an event-triggered fire (HEL-675) passes the triggering event so the
   * DAG can read it (e.g. `{ event, eventSource }`).
   */
  input?: Record<string, unknown>;
}): Promise<DispatchScheduledWorkflowResult> {
  const { pool, runQueue, routine, jobId } = params;

  // 1. Resolve the routine's workflow to the DAG it should run, scoped to the
  //    routine's workspace (tenancy guard even though the worker is sessionless).
  //    HEL-821: run the version DEPLOYED to the routine's environment — the
  //    env's most recent deployment — falling back to the workflow's latest
  //    version when that env has no deployment yet (so undeployed workflows keep
  //    firing the draft).
  const environment = routine.environment ?? "dev";
  const dagResult = await pool.query<WorkflowVersionRow>(
    `SELECT v.id::text AS version_id, v.dag,
            w.external_template_id, w.name AS workflow_name
       FROM workflows w
       JOIN workflow_versions v ON v.id = COALESCE(
         (SELECT d.version_id
            FROM workflow_deployments d
           WHERE d.workflow_id = w.id AND d.environment = $3
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT 1),
         w.latest_version_id)
      WHERE w.id = $1::uuid AND w.workspace_id = $2::uuid`,
    [routine.workflow_id, routine.workspace_id, environment],
  );
  const row = dagResult.rows[0];
  if (!row) {
    return {
      status: "skipped",
      reason: `workflow ${routine.workflow_id} has no latest version in workspace ${routine.workspace_id}`,
    };
  }

  const template = parseJsonColumn<WorkflowTemplate | null>(row.dag, null);
  if (!template || !Array.isArray(template.steps) || template.steps.length === 0) {
    return {
      status: "skipped",
      reason: `workflow ${routine.workflow_id} latest version has no runnable steps`,
    };
  }

  // The DAG JSON is client-authored (POST /api/workflows stores `body.dag` as-is),
  // so `id`/`name` aren't guaranteed. Prefer the workflow's real
  // external_template_id (so runStore's version upsert attaches to the routine's
  // own workflows row), then the DAG id, then the workflow UUID — never empty.
  const templateId =
    (typeof row.external_template_id === "string" && row.external_template_id) ||
    (typeof template.id === "string" && template.id) ||
    routine.workflow_id;
  const templateName =
    (typeof template.name === "string" && template.name) ||
    (typeof row.workflow_name === "string" && row.workflow_name) ||
    "Scheduled workflow";

  // 2. Attribute the run to the routine's agent owner (workspace / LLM-config
  //    scope), mirroring the prompt cron path. Best-effort.
  let userId: string | undefined;
  if (routine.agent_id) {
    const ownerResult = await pool.query<{ user_id: string }>(
      `SELECT user_id::text FROM agents WHERE id = $1::uuid`,
      [routine.agent_id],
    );
    userId = ownerResult.rows[0]?.user_id ?? undefined;
  }

  // 3. Seed config + input the same way POST /api/runs does.
  const defaultConfig: Record<string, unknown> = {};
  for (const field of template.configFields ?? []) {
    if (field.defaultValue !== undefined) defaultConfig[field.key] = field.defaultValue;
  }
  const input: Record<string, unknown> = {
    workspaceId: routine.workspace_id,
    ...(params.input ?? {}),
  };
  const runConfig: Record<string, unknown> = {
    ...defaultConfig,
    workspaceId: routine.workspace_id,
    // HEL-821: record which environment this run executed (observability); the
    // version it locked to is already on runs.workflow_version_id.
    environment,
  };

  // A retry of the same scheduler job re-derives the same run id; distinct cron
  // ticks get distinct BullMQ job ids, so each tick is a distinct run. The
  // defensive fallback (no jobId) stays tick-unique so a missing id never wedges
  // the schedule to a single run.
  const seed = jobId && jobId.length > 0 ? jobId : `${routine.id}:${Date.now()}`;
  const runId = deterministicScheduledRunId(seed);

  // 4. Create the queued run — idempotently. `runStore.create` swallows a
  //    duplicate-PK error (logs + returns the in-memory clone), so we cannot
  //    detect a re-fire by catching. Guard by checking existence first: a prior
  //    fire of this same job already created the run, so don't recreate it
  //    (recreating would also reset its in-memory status back to `queued`).
  let workflowVersionId: string | undefined;
  const existing = await runStore.get(runId);
  if (existing) {
    workflowVersionId = existing.workflowVersionId;
  } else {
    const created = await runStore.create({
      id: runId,
      templateId,
      templateName,
      workspaceId: routine.workspace_id,
      routineId: routine.id,
      status: "queued",
      startedAt: new Date().toISOString(),
      input,
      workflowDag: template,
      stepResults: [],
      runtimeState: {
        config: { ...runConfig },
        context: { ...runConfig, ...input },
        currentStepIndex: 0,
      },
      ...(userId !== undefined ? { userId } : {}),
    });
    workflowVersionId = created.workflowVersionId;
  }

  // 5. Enqueue onto the "runs" queue. `jobId: runId` makes the enqueue
  //    idempotent (a retry hits JobIdAlreadyExists, caught below); the worker
  //    re-consumes the job — now carrying a `runId` — and drives it through
  //    executeQueuedRun, which owns the running→terminal transitions and its own
  //    per-run idempotency guard.
  const idempotencyKey = `${runId}:0:${workflowVersionId ?? templateId}`;
  try {
    await addRunJob(
      runQueue,
      "run",
      {
        runId,
        templateId,
        ...(workflowVersionId !== undefined ? { workflowVersionId } : {}),
        workspaceId: routine.workspace_id,
        stepIndex: 0,
        idempotencyKey,
      },
      { jobId: runId, removeOnComplete: 100 },
    );
  } catch (err) {
    if (!isJobIdAlreadyExists(err)) {
      throw err;
    }
  }

  return { status: "enqueued", runId };
}
