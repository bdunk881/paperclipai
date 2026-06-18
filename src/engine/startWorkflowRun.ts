/**
 * Shared run-start path (extracted for HEL-710).
 *
 * Both `POST /api/runs` (authenticated) and `POST /api/realtime/trigger/:id`
 * (browser, scoped-token) must start a run identically: the BullMQ path creates
 * a `queued` run record + enqueues a job the worker picks up; the no-Redis path
 * runs inline via the engine. Keeping this in one place stops the two callers
 * from drifting on run-record shape, the HEL-696 idempotency key, or
 * enqueue-failure handling.
 */

import { randomUUID } from "crypto";
import type { WorkflowTemplate, WorkflowRun } from "../types/workflow";
import { runStore } from "./runStore";
import { workflowEngine } from "./WorkflowEngine";
import { getRunQueue, addRunJob, type RunPriority } from "../queue/queues";

export interface StartWorkflowRunParams {
  template: WorkflowTemplate;
  input?: Record<string, unknown>;
  config?: Record<string, unknown>;
  userId?: string;
  workspaceId?: string;
  priority?: RunPriority;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface StartWorkflowRunResult {
  runId: string;
  run: WorkflowRun;
  /** True when the run was enqueued for the worker; false when run inline (no Redis). */
  enqueued: boolean;
}

/** Thrown when the run record was created but the BullMQ enqueue failed. The
 * run is marked `failed` before this throws, so the caller only needs to surface
 * a 503. */
export class RunEnqueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunEnqueueError";
  }
}

export async function startWorkflowRun(
  params: StartWorkflowRunParams,
): Promise<StartWorkflowRunResult> {
  const { template, userId, workspaceId, priority, tags, metadata } = params;

  const resolvedInput = { ...(params.input ?? {}) };
  if (workspaceId) {
    resolvedInput.workspaceId = workspaceId;
  }
  const resolvedConfig = workspaceId
    ? { ...(params.config ?? {}), workspaceId }
    : params.config;

  const runQueue = getRunQueue();
  if (runQueue) {
    // BullMQ path: create the run record with status "queued" and enqueue.
    const defaultConfig: Record<string, unknown> = {};
    for (const field of template.configFields) {
      if (field.defaultValue !== undefined) defaultConfig[field.key] = field.defaultValue;
    }
    const runConfig = { ...defaultConfig, ...(resolvedConfig ?? {}) };
    const runId = randomUUID();
    const run = await runStore.create({
      id: runId,
      templateId: template.id,
      templateName: template.name,
      workspaceId,
      status: "queued",
      startedAt: new Date().toISOString(),
      input: resolvedInput,
      workflowDag: template,
      stepResults: [],
      runtimeState: {
        config: { ...runConfig },
        context: { ...runConfig, ...resolvedInput },
        currentStepIndex: 0,
        // HEL-700: persist priority so resume/retry/crash-resume preserve it.
        ...(priority ? { priority } : {}),
      },
      ...(tags ? { tags } : {}),
      ...(metadata ? { metadata } : {}),
      ...(userId !== undefined ? { userId } : {}),
    });
    const idempotencyKey = `${run.id}:0:${run.workflowVersionId ?? template.id}`;
    try {
      await addRunJob(
        runQueue,
        "run",
        {
          runId: run.id,
          templateId: template.id,
          workflowVersionId: run.workflowVersionId,
          workspaceId: workspaceId ?? "",
          stepIndex: 0,
          idempotencyKey,
          priority,
        },
        { jobId: run.id, removeOnComplete: 100 },
      );
    } catch (enqueueErr) {
      const message = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
      await runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: `Run enqueue failed: ${message}`,
      });
      throw new RunEnqueueError(message);
    }
    return { runId: run.id, run, enqueued: true };
  }

  // Legacy in-process path (used when Redis is not configured).
  const run = await workflowEngine.startRun(template, resolvedInput, resolvedConfig, userId);
  return { runId: run.id, run, enqueued: false };
}
