/**
 * HEL-665: dispatchScheduledWorkflowRun — unit tests.
 *
 * The "runs" cron handler calls this when a workflow-backed routine fires. It
 * must: load the routine's latest-version DAG (scoped to the workspace), create
 * a `queued` run tagged with the workspace + routine + agent owner, enqueue it
 * onto the runs queue with jobId=runId, no-op honestly when there's no runnable
 * version, and stay idempotent across a retry of the same cron-fire job.
 *
 * jest runs the in-memory runStore (isPostgresConfigured() false +
 * AUTOFLOW_ALLOW_INMEMORY=true), so the real store exercises its memory backend.
 */

import {
  dispatchScheduledWorkflowRun,
  deterministicScheduledRunId,
  type ScheduledWorkflowRoutine,
} from "./scheduledWorkflowRun";
import { runStore } from "./runStore";
import type { WorkflowTemplate } from "../types/workflow";

const DAG: WorkflowTemplate = {
  id: "wf-scheduled-tpl",
  name: "Scheduled DAG",
  description: "test workflow",
  category: "custom",
  version: "1",
  configFields: [],
  steps: [
    {
      id: "s1",
      name: "Step one",
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

interface FakeQueueCall {
  name: string;
  data: Record<string, unknown>;
  opts: Record<string, unknown>;
}

function makeFakeQueue(opts?: { dedupe?: boolean }) {
  const calls: FakeQueueCall[] = [];
  const seenJobIds = new Set<string>();
  const add = jest.fn(
    async (name: string, data: Record<string, unknown>, o: Record<string, unknown>) => {
      const jobId = o?.["jobId"] as string | undefined;
      if (opts?.dedupe && jobId && seenJobIds.has(jobId)) {
        throw new Error(`JobIdAlreadyExists: ${jobId}`);
      }
      if (jobId) seenJobIds.add(jobId);
      calls.push({ name, data, opts: o });
      return { id: jobId };
    },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { queue: { add } as any, calls, add };
}

function makePool(rows: { dag?: unknown[]; owner?: unknown[] }) {
  const query = jest.fn(async (sql: string) => {
    if (/FROM workflows/i.test(sql)) {
      const r = rows.dag ?? [];
      return { rows: r, rowCount: r.length };
    }
    if (/FROM agents/i.test(sql)) {
      const r = rows.owner ?? [];
      return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { query } as any;
}

const ROUTINE: ScheduledWorkflowRoutine = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  workflow_id: "33333333-3333-4333-8333-333333333333",
  agent_id: "44444444-4444-4444-8444-444444444444",
};

describe("dispatchScheduledWorkflowRun (HEL-665)", () => {
  beforeEach(async () => {
    await runStore.clear();
    jest.clearAllMocks();
  });

  it("creates a queued run + enqueues it for a workflow-backed routine", async () => {
    const { queue, calls } = makeFakeQueue();
    const pool = makePool({ dag: [{ version_id: "v-1", dag: DAG }], owner: [{ user_id: "user-9" }] });

    const result = await dispatchScheduledWorkflowRun({
      pool,
      runQueue: queue,
      routine: ROUTINE,
      jobId: "job-abc",
    });

    expect(result.status).toBe("enqueued");
    const runId = result.status === "enqueued" ? result.runId : "";
    expect(runId).toBe(deterministicScheduledRunId("job-abc"));

    // run row persisted as queued, tagged with workspace + routine + DAG + owner
    const run = await runStore.get(runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("queued");
    expect(run!.workspaceId).toBe(ROUTINE.workspace_id);
    expect(run!.routineId).toBe(ROUTINE.id);
    expect(run!.userId).toBe("user-9");
    expect((run!.workflowDag as WorkflowTemplate).steps).toHaveLength(1);
    expect(run!.runtimeState?.context).toMatchObject({ workspaceId: ROUTINE.workspace_id });

    // enqueued on the runs queue with jobId=runId at stepIndex 0
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("run");
    expect(calls[0]!.data).toMatchObject({
      runId,
      templateId: DAG.id,
      workspaceId: ROUTINE.workspace_id,
      stepIndex: 0,
    });
    expect(calls[0]!.opts).toMatchObject({ jobId: runId });
  });

  it("resolves the env-deployed version for the routine's environment (HEL-821)", async () => {
    const { queue } = makeFakeQueue();
    const pool = makePool({ dag: [{ version_id: "v-prod", dag: DAG }], owner: [{ user_id: "u" }] });

    const result = await dispatchScheduledWorkflowRun({
      pool,
      runQueue: queue,
      routine: { ...ROUTINE, environment: "prod" },
      jobId: "job-env",
    });

    expect(result.status).toBe("enqueued");
    // The DAG-resolution query received the routine's environment as $3 (so the
    // COALESCE picks that env's current deployment).
    const wfCall = (pool.query as jest.Mock).mock.calls.find((c: unknown[]) =>
      /FROM workflows/i.test(c[0] as string),
    );
    expect(wfCall).toBeDefined();
    expect(wfCall![1]).toEqual([ROUTINE.workflow_id, ROUTINE.workspace_id, "prod"]);

    // The run records which environment it executed.
    const runId = result.status === "enqueued" ? result.runId : "";
    const run = await runStore.get(runId);
    expect(run!.runtimeState?.config).toMatchObject({ environment: "prod" });
  });

  it("defaults to the 'dev' environment when the routine has none (HEL-821)", async () => {
    const { queue } = makeFakeQueue();
    const pool = makePool({ dag: [{ version_id: "v-1", dag: DAG }], owner: [{ user_id: "u" }] });

    await dispatchScheduledWorkflowRun({ pool, runQueue: queue, routine: ROUTINE, jobId: "job-dev" });

    const wfCall = (pool.query as jest.Mock).mock.calls.find((c: unknown[]) =>
      /FROM workflows/i.test(c[0] as string),
    );
    expect((wfCall![1] as unknown[])[2]).toBe("dev");
  });

  it("skips (honest no-op) when the workflow has no latest version", async () => {
    const { queue, calls } = makeFakeQueue();
    const pool = makePool({ dag: [] });

    const result = await dispatchScheduledWorkflowRun({
      pool,
      runQueue: queue,
      routine: ROUTINE,
      jobId: "job-x",
    });

    expect(result).toEqual({ status: "skipped", reason: expect.stringContaining("no latest version") });
    expect(calls).toHaveLength(0);
  });

  it("skips when the latest version DAG has no runnable steps", async () => {
    const { queue, calls } = makeFakeQueue();
    const pool = makePool({ dag: [{ version_id: "v-1", dag: { ...DAG, steps: [] } }] });

    const result = await dispatchScheduledWorkflowRun({
      pool,
      runQueue: queue,
      routine: ROUTINE,
      jobId: "job-x",
    });

    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("is idempotent across a retry of the same cron-fire job", async () => {
    const { queue, add } = makeFakeQueue({ dedupe: true });
    const pool = makePool({ dag: [{ version_id: "v-1", dag: DAG }], owner: [{ user_id: "user-9" }] });

    const r1 = await dispatchScheduledWorkflowRun({ pool, runQueue: queue, routine: ROUTINE, jobId: "job-retry" });
    const r2 = await dispatchScheduledWorkflowRun({ pool, runQueue: queue, routine: ROUTINE, jobId: "job-retry" });

    // same run id both times; the duplicate enqueue is swallowed, not thrown
    expect(r1).toEqual(r2);
    expect(r1.status).toBe("enqueued");
    expect(add).toHaveBeenCalledTimes(2);

    // exactly one run row exists for the workspace — no duplicate created
    const runs = await runStore.list(undefined, undefined, undefined, ROUTINE.workspace_id);
    expect(runs).toHaveLength(1);
  });

  it("derives a stable, RFC-4122-shaped run id from the seed", () => {
    const a = deterministicScheduledRunId("seed-1");
    expect(deterministicScheduledRunId("seed-1")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicScheduledRunId("seed-2")).not.toBe(a);
  });
});
