/**
 * HEL-176: WorkflowEngine.replayFromStep — unit tests.
 *
 * Covers the happy path (resume after a mid-workflow failure, cloning
 * the successful prefix) plus the validation guards (bad stepIndex,
 * non-success prefix, unknown run).
 */

// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("./llmProviders", () => ({
  getProvider: jest.fn(),
}));

import { WorkflowEngine, registerAction, setLlmProvider } from "./WorkflowEngine";
import { runStore } from "./runStore";
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import { memoryStore } from "./memoryStore";
import { WorkflowRun, WorkflowTemplate, StepResult } from "../types/workflow";

async function waitForCompletion(
  runId: string,
  timeoutMs = 3000
): Promise<WorkflowRun> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runStore.get(runId);
    if (run && ["completed", "failed"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const run = await runStore.get(runId);
  throw new Error(`Run ${runId} did not terminate in ${timeoutMs}ms (last status: ${run?.status})`);
}

let engine: WorkflowEngine;

/**
 * 3-step template:
 *   step-1 (action) — produces { firstOutput }
 *   step-2 (action) — produces { secondOutput }
 *   step-3 (action) — produces { thirdOutput } OR fails if shouldFail=true
 *
 * The action handlers are reassigned per-test so each scenario controls
 * whether step-3 fails on the original run.
 */
const TEMPLATE: WorkflowTemplate = {
  id: "tpl-replay",
  name: "Replay test template",
  description: "Three sequential actions used to exercise replay-from-step",
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
      action: "replay.step1",
    },
    {
      id: "step-2",
      name: "Step two",
      kind: "action",
      description: "Action two",
      inputKeys: ["firstOutput"],
      outputKeys: ["secondOutput"],
      action: "replay.step2",
    },
    {
      id: "step-3",
      name: "Step three",
      kind: "action",
      description: "Action three (failure-prone)",
      inputKeys: ["secondOutput"],
      outputKeys: ["thirdOutput"],
      action: "replay.step3",
    },
  ],
  sampleInput: {},
  expectedOutput: {},
};

beforeEach(() => {
  void runStore.clear();
  void approvalStore.clear();
  void approvalPolicyStore.clear();
  memoryStore.clear();
  engine = new WorkflowEngine();

  // Minimal LLM provider so the engine wiring is satisfied — none of the
  // template steps actually use it.
  setLlmProvider(async () => JSON.stringify({ result: "n/a" }));

  registerAction("replay.step1", async () => ({ firstOutput: "first-value" }));
  registerAction("replay.step2", async () => ({ secondOutput: "second-value" }));
  registerAction("replay.step3", async () => ({ thirdOutput: "third-value" }));
});

describe("WorkflowEngine.replayFromStep — validation", () => {
  it("rejects an unknown run id", async () => {
    await expect(engine.replayFromStep("unknown-run", 1)).rejects.toThrow(/not found/i);
  });

  it("rejects stepIndex <= 0", async () => {
    const run = await engine.startRun(TEMPLATE, {});
    await waitForCompletion(run.id);

    await expect(engine.replayFromStep(run.id, 0)).rejects.toThrow(/stepIndex must be > 0/);
    await expect(engine.replayFromStep(run.id, -1)).rejects.toThrow(/stepIndex must be > 0/);
  });

  it("rejects stepIndex >= template.steps.length", async () => {
    const run = await engine.startRun(TEMPLATE, {});
    await waitForCompletion(run.id);

    await expect(engine.replayFromStep(run.id, TEMPLATE.steps.length)).rejects.toThrow(
      /beyond template length/i
    );
    await expect(engine.replayFromStep(run.id, TEMPLATE.steps.length + 1)).rejects.toThrow(
      /beyond template length/i
    );
  });

  it("rejects non-integer stepIndex", async () => {
    const run = await engine.startRun(TEMPLATE, {});
    await waitForCompletion(run.id);

    await expect(engine.replayFromStep(run.id, 1.5)).rejects.toThrow(/must be an integer/);
  });

  it("rejects when a prior step is not 'success'", async () => {
    // 4-step template: step-1 succeeds, step-2 fails, step-3 and step-4
    // never execute. Replaying from index 2 must reject because step-2
    // (the prefix's last entry) is 'failure'.
    registerAction("replay.bad", async () => {
      throw new Error("step-2 boom");
    });

    const tpl: WorkflowTemplate = {
      ...TEMPLATE,
      id: "tpl-replay-bad",
      steps: [
        {
          id: "step-1",
          name: "Step one",
          kind: "action",
          description: "Action one",
          inputKeys: [],
          outputKeys: ["firstOutput"],
          action: "replay.step1",
        },
        {
          id: "step-bad",
          name: "Bad step",
          kind: "action",
          description: "Always fails",
          inputKeys: [],
          outputKeys: [],
          action: "replay.bad",
        },
        {
          id: "step-3",
          name: "Step three",
          kind: "action",
          description: "Never runs in the original",
          inputKeys: [],
          outputKeys: ["thirdOutput"],
          action: "replay.step3",
        },
        {
          id: "step-4",
          name: "Step four",
          kind: "action",
          description: "Pad to length 4",
          inputKeys: [],
          outputKeys: [],
          action: "replay.step3",
        },
      ],
    };

    const run = await engine.startRun(tpl, {});
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("failed");
    expect(completed.stepResults[1].status).toBe("failure");

    // Index 2 = "skip step-1 and step-bad, start at step-3". Prefix is
    // [step-1 success, step-bad failure] — must reject.
    await expect(engine.replayFromStep(run.id, 2)).rejects.toThrow(/not 'success'/);
  });
});

describe("WorkflowEngine.replayFromStep — happy path", () => {
  it("clones the successful prefix and resumes the run to completion", async () => {
    // Configure step-3 to fail on the first attempt, then succeed when the
    // replay re-runs it.
    let step3CallCount = 0;
    registerAction("replay.step3", async () => {
      step3CallCount += 1;
      if (step3CallCount === 1) {
        throw new Error("transient failure on first attempt");
      }
      return { thirdOutput: "third-value-after-replay" };
    });

    const originalRun = await engine.startRun(TEMPLATE, { foo: "bar" });
    const originalCompleted = await waitForCompletion(originalRun.id);

    expect(originalCompleted.status).toBe("failed");
    expect(originalCompleted.stepResults).toHaveLength(3);
    expect(originalCompleted.stepResults[0].status).toBe("success");
    expect(originalCompleted.stepResults[1].status).toBe("success");
    expect(originalCompleted.stepResults[2].status).toBe("failure");

    // Replay from step 2 (zero-indexed): keep step-1 and step-2 results,
    // re-run step-3.
    const replayRun = await engine.replayFromStep(originalRun.id, 2);

    expect(replayRun.id).not.toBe(originalRun.id);
    expect(replayRun.templateId).toBe(TEMPLATE.id);
    expect(["pending", "running"]).toContain(replayRun.status);
    // The pending response should already have 2 cloned step_results
    // visible — that's the contract the dashboard relies on.
    expect(replayRun.stepResults).toHaveLength(2);
    expect(replayRun.stepResults[0].stepId).toBe("step-1");
    expect(replayRun.stepResults[0].output).toEqual(
      originalCompleted.stepResults[0].output
    );
    expect(replayRun.stepResults[1].stepId).toBe("step-2");
    expect(replayRun.stepResults[1].output).toEqual(
      originalCompleted.stepResults[1].output
    );
    // Idempotency keys must be regenerated; the unique index would
    // otherwise reject the inserts.
    expect(replayRun.stepResults[0].idempotencyKey).toBeDefined();
    expect(replayRun.stepResults[0].idempotencyKey).not.toBe(
      originalCompleted.stepResults[0].idempotencyKey
    );

    // runtimeState should point at the resumed step so a crash mid-replay
    // still tells observers where execution is supposed to pick up.
    expect(replayRun.runtimeState?.currentStepIndex).toBe(2);

    const finalRun = await waitForCompletion(replayRun.id);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.stepResults).toHaveLength(3);

    // Step-3 ran exactly twice across both runs: once on the original
    // (which failed), once on the replay (which succeeded). Step-1 and
    // step-2 must not have re-executed.
    expect(step3CallCount).toBe(2);

    // The replayed step-3 result reflects the SECOND invocation's output.
    expect(finalRun.stepResults[2].output).toMatchObject({
      thirdOutput: "third-value-after-replay",
    });

    // The cloned step-1 / step-2 outputs are byte-equal to the originals.
    expect(finalRun.stepResults[0].output).toEqual(
      originalCompleted.stepResults[0].output,
    );
    expect(finalRun.stepResults[1].output).toEqual(
      originalCompleted.stepResults[1].output,
    );

    // The original run is untouched — still 'failed', no side-effects.
    const originalAfter = await runStore.get(originalRun.id);
    expect(originalAfter?.status).toBe("failed");
    expect(originalAfter?.id).toBe(originalRun.id);
  });

  it("propagates cloned step outputs into the resumed step's context", async () => {
    // Make step-3 assert it can see secondOutput in its config — this is
    // the engine's normal step-output threading pattern.
    let observedSecondOutput: unknown = "<unset>";
    registerAction("replay.step3", async (inputs) => {
      observedSecondOutput = inputs["secondOutput"];
      return { thirdOutput: "ok" };
    });

    // Force failure on the original to make replay legal.
    const originalRun = await engine.startRun(TEMPLATE, {});
    // The first call to step-3 in the original run sees "second-value".
    await waitForCompletion(originalRun.id);

    // Now strip the original observation and replay.
    observedSecondOutput = "<replay-unset>";
    const replayRun = await engine.replayFromStep(originalRun.id, 2);
    await waitForCompletion(replayRun.id);

    // After the replay, step-3's input handler observed the cloned
    // secondOutput rather than '<replay-unset>'.
    expect(observedSecondOutput).toBe("second-value");
  });
});

describe("WorkflowEngine.replayFromStep — step result preservation", () => {
  it("preserves output JSON byte-for-byte across clones", async () => {
    // Step-1 produces a structured object — make sure JSON nesting +
    // ordering survive the clone.
    registerAction("replay.step1", async () => ({
      firstOutput: {
        nested: { a: 1, b: [2, 3, { c: "deep" }] },
        flag: true,
      },
    }));

    const original = await engine.startRun(TEMPLATE, {});
    await waitForCompletion(original.id);

    const replay = await engine.replayFromStep(original.id, 1);
    const clonedStep1: StepResult | undefined = replay.stepResults[0];
    expect(clonedStep1).toBeDefined();
    expect(JSON.stringify(clonedStep1!.output)).toBe(
      JSON.stringify((await runStore.get(original.id))!.stepResults[0].output)
    );
  });
});
