/**
 * HEL-702: triggerBatch — unit tests.
 *
 * Fans a workflow out over N inputs: creates N `queued` runs (the durable
 * `POST /api/runs` path), enqueues each on the runs queue, and records one
 * `run_batches` row grouping their ids. `dryRun` seeds HEL-786's `__dryRun` into
 * every run's config. Always-queued — never inline-executes in the request.
 *
 * jest runs the in-memory runStore + batchStore (isPostgresConfigured() false +
 * AUTOFLOW_ALLOW_INMEMORY=true), so the real stores exercise their memory
 * backends and a fake queue records enqueue calls.
 */

import { triggerBatch, MAX_BATCH_INPUTS } from "./batchTrigger";
import { runStore } from "./runStore";
import { batchStore } from "./batchStore";
import { DRY_RUN_KEY } from "./dryRun";
import type { WorkflowTemplate } from "../types/workflow";

const WS = "22222222-2222-4222-8222-222222222222";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";

const TEMPLATE: WorkflowTemplate = {
  id: "wf-batch-tpl",
  name: "Batch DAG",
  description: "test workflow",
  category: "custom",
  version: "1",
  configFields: [],
  steps: [
    {
      id: "s1",
      name: "Do thing",
      kind: "action",
      description: "",
      inputKeys: [],
      outputKeys: ["out"],
      action: "noop",
    },
  ],
  sampleInput: {},
  expectedOutput: {},
};

function makeFakeQueue() {
  const calls: Array<{ name: string; data: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const add = jest.fn(
    async (name: string, data: Record<string, unknown>, opts: Record<string, unknown>) => {
      calls.push({ name, data, opts });
      return { id: opts?.["jobId"] };
    },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { queue: { add } as any, calls, add };
}

describe("triggerBatch (HEL-702)", () => {
  beforeEach(async () => {
    await runStore.clear();
    await batchStore.clear();
    jest.clearAllMocks();
  });

  it("fans out N queued runs + records a batch row grouping them", async () => {
    const { queue, calls } = makeFakeQueue();

    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [{ a: 1 }, { a: 2 }, { a: 3 }],
      runQueue: queue,
      workspaceId: WS,
      userId: "user-9",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(3);
    expect(result.runIds).toHaveLength(3);

    // every run persisted as queued, tagged with the workspace + per-input data
    const runs = await runStore.listByIds(result.runIds, WS);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.status).toBe("queued");
      expect(run.workspaceId).toBe(WS);
      expect(run.userId).toBe("user-9");
      expect(run.input.workspaceId).toBe(WS);
    }
    expect(runs.map((r) => r.input.a).sort()).toEqual([1, 2, 3]);

    // batch row holds exactly those run ids
    const batch = await batchStore.get(result.batchId, WS);
    expect(batch).toBeDefined();
    expect(batch!.total).toBe(3);
    expect(batch!.runIds.sort()).toEqual([...result.runIds].sort());
    expect(batch!.externalTemplateId).toBe(TEMPLATE.id);
    expect(batch!.dryRun).toBe(false);

    // each run enqueued on the "runs" queue with jobId=runId at stepIndex 0
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.name).toBe("run");
      expect(call.data).toMatchObject({ templateId: TEMPLATE.id, workspaceId: WS, stepIndex: 0 });
      expect(call.opts).toMatchObject({ jobId: call.data.runId });
    }
  });

  it("seeds __dryRun into every run's config + context when dryRun is true", async () => {
    const { queue } = makeFakeQueue();

    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [{ a: 1 }, { a: 2 }],
      runQueue: queue,
      workspaceId: WS,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const runs = await runStore.listByIds(result.runIds, WS);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.runtimeState?.config[DRY_RUN_KEY]).toBe(true);
      expect(run.runtimeState?.context[DRY_RUN_KEY]).toBe(true);
    }

    const batch = await batchStore.get(result.batchId, WS);
    expect(batch!.dryRun).toBe(true);
  });

  it("does not set __dryRun when dryRun is omitted, and merges shared config", async () => {
    const { queue } = makeFakeQueue();

    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [{ a: 1 }],
      runQueue: queue,
      workspaceId: WS,
      config: { tone: "formal" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [run] = await runStore.listByIds(result.runIds, WS);
    expect(run!.runtimeState?.config[DRY_RUN_KEY]).toBeUndefined();
    expect(run!.runtimeState?.config.tone).toBe("formal");
    expect(run!.runtimeState?.config.workspaceId).toBe(WS);
  });

  it("stays durably queued without a queue (never inline-executes a batch)", async () => {
    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [{ a: 1 }, { a: 2 }],
      runQueue: null,
      workspaceId: WS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const runs = await runStore.listByIds(result.runIds, WS);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.status).toBe("queued");
    }
    const batch = await batchStore.get(result.batchId, WS);
    expect(batch!.total).toBe(2);
  });

  it("scopes the batch to its workspace", async () => {
    const { queue } = makeFakeQueue();
    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [{ a: 1 }],
      runQueue: queue,
      workspaceId: WS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await batchStore.get(result.batchId, WS)).toBeDefined();
    expect(await batchStore.get(result.batchId, OTHER_WS)).toBeUndefined();
  });

  it("rejects an empty input array (no runs, no batch)", async () => {
    const { queue, calls } = makeFakeQueue();
    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: [],
      runQueue: queue,
      workspaceId: WS,
    });

    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/non-empty/i) });
    expect(calls).toHaveLength(0);
    expect(await batchStore.list(WS)).toHaveLength(0);
  });

  it("rejects an input array over the per-batch cap", async () => {
    const { queue, calls } = makeFakeQueue();
    const result = await triggerBatch({
      template: TEMPLATE,
      inputs: Array.from({ length: MAX_BATCH_INPUTS + 1 }, () => ({})),
      runQueue: queue,
      workspaceId: WS,
    });

    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/cap/i) });
    expect(calls).toHaveLength(0);
    expect(await batchStore.list(WS)).toHaveLength(0);
  });
});
