/**
 * HEL-478: WorkflowEngine.executeQueuedRun — unit tests.
 *
 * The BullMQ "runs" worker calls this for every queued DAG job. It must:
 *   - drive a fresh queued run (stepIndex 0) to completion, writing step_results
 *   - be idempotent: skip any run already past queued/pending so a BullMQ retry
 *     never re-runs side-effecting steps
 *   - resume a replay-from-step run (stepIndex N>0) on top of its cloned prefix
 *   - re-run a retried run (stale step_results, stepIndex 0) from a clean slate
 *   - mark the run failed when a step fails
 *   - throw on an unknown run id (so the worker can retry/DLQ)
 */

// Prevent transitive import of the ESM-only @mistralai/mistralai package
jest.mock("./llmProviders", () => ({
  getProvider: jest.fn(),
}));

import { randomUUID } from "node:crypto";
import { WorkflowEngine, registerAction, setLlmProvider } from "./WorkflowEngine";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import { memoryStore } from "./memoryStore";
import { WorkflowRun, WorkflowTemplate, StepResult } from "../types/workflow";

let engine: WorkflowEngine;
let step1Calls = 0;
let step2Calls = 0;

/**
 * 2-step template:
 *   step-1 (action) — produces { firstOutput }
 *   step-2 (action) — produces { secondOutput } OR fails when shouldFail set
 */
const TEMPLATE: WorkflowTemplate = {
  id: "tpl-queued",
  name: "Queued run test template",
  description: "Two sequential actions used to exercise executeQueuedRun",
  category: "custom",
  version: "1",
  configFields: [],
  steps: [
    {
      id: "step-1",
      name: "Step one",
      kind: "action",
      description: "Action one",
      inputKeys: [],
      outputKeys: ["firstOutput"],
      action: "queued.step1",
    },
    {
      id: "step-2",
      name: "Step two",
      kind: "action",
      description: "Action two",
      inputKeys: ["firstOutput"],
      outputKeys: ["secondOutput"],
      action: "queued.step2",
    },
  ],
  sampleInput: {},
  expectedOutput: {},
};

/** Mirrors the `status:"queued"` run row app.ts creates before enqueuing. */
async function createQueuedRun(opts: {
  template?: WorkflowTemplate;
  input?: Record<string, unknown>;
  stepResults?: StepResult[];
  currentStepIndex?: number;
  status?: WorkflowRun["status"];
  context?: Record<string, unknown>;
} = {}): Promise<string> {
  const template = opts.template ?? TEMPLATE;
  const id = randomUUID();
  const config: Record<string, unknown> = {};
  await runStore.create({
    id,
    templateId: template.id,
    templateName: template.name,
    workspaceId: "ws-1",
    status: opts.status ?? "queued",
    startedAt: new Date().toISOString(),
    input: opts.input ?? {},
    workflowDag: template,
    stepResults: opts.stepResults ?? [],
    runtimeState: {
      config,
      context: opts.context ?? { ...config, ...(opts.input ?? {}) },
      currentStepIndex: opts.currentStepIndex ?? 0,
    },
    userId: "user-1",
  });
  return id;
}

beforeEach(() => {
  void runStore.clear();
  void approvalStore.clear();
  void approvalPolicyStore.clear();
  memoryStore.clear();
  engine = new WorkflowEngine();
  step1Calls = 0;
  step2Calls = 0;

  setLlmProvider(async () => JSON.stringify({ result: "n/a" }));

  registerAction("queued.step1", async () => {
    step1Calls += 1;
    return { firstOutput: "first-value" };
  });
  registerAction("queued.step2", async (inputs) => {
    step2Calls += 1;
    return { secondOutput: "second-value", sawFirst: inputs["firstOutput"] };
  });
});

describe("WorkflowEngine.executeQueuedRun — happy path", () => {
  it("drives a fresh queued run to completion and writes step_results", async () => {
    const runId = await createQueuedRun();

    await engine.executeQueuedRun(runId, 0);

    const run = await runStore.get(runId);
    expect(run?.status).toBe("completed");
    expect(run?.stepResults).toHaveLength(2);
    expect(run?.stepResults[0].status).toBe("success");
    expect(run?.stepResults[1].status).toBe("success");
    expect(run?.stepResults[1].output).toMatchObject({
      secondOutput: "second-value",
      sawFirst: "first-value", // step-1 output threaded into step-2 context
    });
    expect(step1Calls).toBe(1);
    expect(step2Calls).toBe(1);
  });

  it("defaults startStepIndex to 0 when omitted", async () => {
    const runId = await createQueuedRun();
    await engine.executeQueuedRun(runId);
    const run = await runStore.get(runId);
    expect(run?.status).toBe("completed");
    expect(run?.stepResults).toHaveLength(2);
  });
});

describe("WorkflowEngine.executeQueuedRun — idempotency", () => {
  it("is a no-op for a run already past queued/pending (BullMQ retry safety)", async () => {
    const runId = await createQueuedRun({ status: "completed" });

    await engine.executeQueuedRun(runId, 0);

    const run = await runStore.get(runId);
    expect(run?.status).toBe("completed");
    // No steps re-executed — the side-effecting handlers never ran.
    expect(step1Calls).toBe(0);
    expect(step2Calls).toBe(0);
  });

  it("is a no-op for a run already running", async () => {
    const runId = await createQueuedRun({ status: "running" });
    await engine.executeQueuedRun(runId, 0);
    expect(step1Calls).toBe(0);
    expect(step2Calls).toBe(0);
    expect((await runStore.get(runId))?.status).toBe("running");
  });

  it("throws on an unknown run id so the worker can retry/DLQ", async () => {
    await expect(engine.executeQueuedRun("does-not-exist", 0)).rejects.toThrow(/not found/i);
  });
});

describe("WorkflowEngine.executeQueuedRun — resume (replay-from-step)", () => {
  it("resumes from stepIndex N on top of the cloned prefix without re-running it", async () => {
    // Simulate what replayFromStep({skipExecution}) persists: a queued run
    // with step-1 already cloned as a success + a context carrying its output.
    const clonedPrefix: StepResult[] = [
      {
        stepId: "step-1",
        stepName: "Step one",
        status: "success",
        output: { firstOutput: "cloned-first" },
        durationMs: 5,
        idempotencyKey: `${randomUUID()}:0:replay-from-step`,
      },
    ];
    const runId = await createQueuedRun({
      stepResults: clonedPrefix,
      currentStepIndex: 1,
      context: { firstOutput: "cloned-first" },
    });

    await engine.executeQueuedRun(runId, 1);

    const run = await runStore.get(runId);
    expect(run?.status).toBe("completed");
    expect(run?.stepResults).toHaveLength(2);
    // The cloned prefix survives untouched; step-1 did NOT re-run.
    expect(step1Calls).toBe(0);
    expect(step2Calls).toBe(1);
    expect(run?.stepResults[0].output).toEqual({ firstOutput: "cloned-first" });
    // step-2 saw the cloned prefix output in its context.
    expect(run?.stepResults[1].output).toMatchObject({ sawFirst: "cloned-first" });
  });
});

describe("WorkflowEngine.executeQueuedRun — retry (stepIndex 0, stale results)", () => {
  it("re-runs from a clean slate, discarding a prior attempt's step_results", async () => {
    // A /retry resets status→queued but leaves the failed attempt's
    // step_results + polluted runtimeState.context in place. stepIndex 0 must
    // ignore both and re-run every step, producing exactly 2 results (not 4).
    const staleResults: StepResult[] = [
      {
        stepId: "step-1",
        stepName: "Step one",
        status: "success",
        output: { firstOutput: "stale" },
        durationMs: 1,
      },
      {
        stepId: "step-2",
        stepName: "Step two",
        status: "failure",
        output: {},
        durationMs: 1,
        error: "boom",
      },
    ];
    const runId = await createQueuedRun({
      stepResults: staleResults,
      currentStepIndex: 0,
      context: { firstOutput: "stale", polluted: true },
    });

    await engine.executeQueuedRun(runId, 0);

    const run = await runStore.get(runId);
    expect(run?.status).toBe("completed");
    expect(run?.stepResults).toHaveLength(2);
    expect(step1Calls).toBe(1);
    expect(step2Calls).toBe(1);
    // Fresh step-1 output replaced the stale clone.
    expect(run?.stepResults[0].output).toMatchObject({ firstOutput: "first-value" });
  });
});

describe("WorkflowEngine.executeQueuedRun — failure", () => {
  it("marks the run failed when a step throws", async () => {
    registerAction("queued.step2", async () => {
      step2Calls += 1;
      throw new Error("step-2 boom");
    });
    const runId = await createQueuedRun();

    await engine.executeQueuedRun(runId, 0);

    const run = await runStore.get(runId);
    expect(run?.status).toBe("failed");
    expect(run?.stepResults).toHaveLength(2);
    expect(run?.stepResults[1].status).toBe("failure");
    expect(run?.stepResults[1].error).toMatch(/step-2 boom/);
  });
});
