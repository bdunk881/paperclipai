/**
 * Batch triggering (HEL-702 / Ph3) — fan a workflow out over N inputs.
 *
 * Runs today start one at a time (`POST /api/runs`). A *batch* creates + enqueues
 * N of those runs together and records a {@link RunBatch} row grouping their ids,
 * so a caller (e.g. the HEL-776 eval) can fire a workflow over a dataset with one
 * call and track the set with one handle.
 *
 * Each run is a normal durable run — `runStore.create({status:"queued"})` then
 * `runQueue.add("run", …, {jobId: runId})` — exactly the path `POST /api/runs`
 * and `dispatchScheduledWorkflowRun` use, so the existing worker / idempotency /
 * retry / DLQ machinery executes it unchanged. **Always-queued:** a batch never
 * inline-executes N runs in the request thread; without a queue (tests / local
 * no-Redis) the runs stay durably `queued` for a worker to drain.
 *
 * The `dryRun` flag seeds HEL-786's `__dryRun` into every run's config, so an
 * eval can run a workflow N times without firing N real webhooks / writes.
 */

import { randomUUID } from "crypto";
import type { Queue } from "bullmq";
import type { RunJobPayload } from "../queue/queues";
import { addRunJob } from "../queue/queues";
import { isJobIdAlreadyExists } from "../queue/bullMqJobId";
import type { WorkflowTemplate } from "../types/workflow";
import { runStore } from "./runStore";
import { batchStore, type RunBatch } from "./batchStore";
import { DRY_RUN_KEY } from "./dryRun";

/**
 * Max inputs per batch. v1 fans out synchronously in the request thread (one
 * `runStore.create` + enqueue per input), so the cap bounds request latency and
 * blast radius. A durable async/chunked fan-out worker is the follow-up for
 * reaching trigger.dev's ≤1000.
 */
export const MAX_BATCH_INPUTS = 500;

export interface TriggerBatchParams {
  /** The (already loaded) workflow to fan out — the route resolves + 404s it. */
  template: WorkflowTemplate;
  /** One run per element. Each becomes a run's `input` (coerced to an object). */
  inputs: unknown[];
  /** The "runs" BullMQ queue, or null when Redis is unconfigured. */
  runQueue: Queue<RunJobPayload> | null;
  workspaceId: string;
  userId?: string;
  /** Shared config merged into every run (workspaceId is added automatically). */
  config?: Record<string, unknown>;
  /** When true, every run's config carries `__dryRun` (HEL-786). */
  dryRun?: boolean;
}

export type TriggerBatchResult =
  | { ok: true; batchId: string; runIds: string[]; total: number }
  | { ok: false; reason: string };

function asInputObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export async function triggerBatch(params: TriggerBatchParams): Promise<TriggerBatchResult> {
  const { template, inputs, runQueue, workspaceId, userId, config, dryRun } = params;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, reason: "inputs must be a non-empty array" };
  }
  if (inputs.length > MAX_BATCH_INPUTS) {
    return { ok: false, reason: `inputs exceeds the per-batch cap of ${MAX_BATCH_INPUTS}` };
  }

  // Config precedence mirrors POST /api/runs: template defaults < caller config
  // < workspace + dry-run markers.
  const defaultConfig: Record<string, unknown> = {};
  for (const field of template.configFields ?? []) {
    if (field.defaultValue !== undefined) defaultConfig[field.key] = field.defaultValue;
  }
  const baseConfig: Record<string, unknown> = {
    ...defaultConfig,
    ...(config ?? {}),
    workspaceId,
    ...(dryRun ? { [DRY_RUN_KEY]: true } : {}),
  };

  const batchId = randomUUID();
  const runIds: string[] = [];
  let workflowVersionId: string | undefined;

  for (const rawInput of inputs) {
    const input: Record<string, unknown> = { ...asInputObject(rawInput), workspaceId };
    const runConfig = { ...baseConfig };
    const runId = randomUUID();

    const run = await runStore.create({
      id: runId,
      templateId: template.id,
      templateName: template.name,
      workspaceId,
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
    runIds.push(run.id);
    if (!workflowVersionId && run.workflowVersionId) {
      workflowVersionId = run.workflowVersionId;
    }

    if (runQueue) {
      const idempotencyKey = `${run.id}:0:${run.workflowVersionId ?? template.id}`;
      try {
        await addRunJob(
          runQueue,
          "run",
          {
            runId: run.id,
            templateId: template.id,
            ...(run.workflowVersionId !== undefined
              ? { workflowVersionId: run.workflowVersionId }
              : {}),
            workspaceId,
            stepIndex: 0,
            idempotencyKey,
          },
          { jobId: run.id, removeOnComplete: 100 },
        );
      } catch (err) {
        // A re-fire of the same run id is fine (idempotent). Any other enqueue
        // failure marks just that run failed — the batch reflects reality and
        // the rest of the fan-out continues. Mirrors POST /api/runs.
        if (!isJobIdAlreadyExists(err)) {
          await runStore.update(run.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: `Run enqueue failed: ${(err as Error).message}`,
          });
        }
      }
    }
  }

  const batch: RunBatch = {
    id: batchId,
    workspaceId,
    ...(workflowVersionId ? { workflowVersionId } : {}),
    externalTemplateId: template.id,
    name: template.name,
    total: runIds.length,
    runIds,
    dryRun: dryRun === true,
    ...(userId !== undefined ? { createdByUserId: userId } : {}),
    createdAt: new Date().toISOString(),
  };
  await batchStore.create(batch);

  return { ok: true, batchId, runIds, total: runIds.length };
}
