/**
 * HEL-789: dry-run completeness — a dry-run workflow must run to a terminal
 * state through `wait` and `approval` steps instead of pausing. Without the
 * short-circuits, the approval step flips the run to `awaiting_approval` (and a
 * wait re-enqueues), so an eval over such a workflow would stall forever.
 */

// Prevent transitive import of the ESM-only @mistralai/mistralai package.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

import { workflowEngine } from "./WorkflowEngine";
import { runStore } from "./runStore";
import { DRY_RUN_KEY } from "./dryRun";
import type { WorkflowRun, WorkflowTemplate } from "../types/workflow";

async function waitForCompletion(runId: string, timeoutMs = 3000): Promise<WorkflowRun> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runStore.get(runId);
    if (run && ["completed", "failed"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const run = await runStore.get(runId);
  throw new Error(`Run ${runId} did not complete in ${timeoutMs}ms. Last status: ${run?.status}`);
}

// trigger → wait → approval → output. The wait + approval would normally pause
// the run; under dry-run both short-circuit so the run completes.
const template: WorkflowTemplate = {
  id: "tpl-hel789-dryrun",
  name: "HEL-789 dry-run completeness",
  description: "trigger -> wait -> approval -> output",
  category: "custom",
  version: "1.0.0",
  configFields: [],
  steps: [
    { id: "trigger", name: "Trigger", kind: "trigger", description: "", inputKeys: [], outputKeys: ["payload"] },
    {
      id: "wait",
      name: "Wait",
      kind: "wait",
      description: "",
      inputKeys: [],
      outputKeys: [],
      config: { mode: "duration", amount: 30, unit: "minutes" },
    },
    {
      id: "approval",
      name: "Approve",
      kind: "approval",
      description: "",
      inputKeys: [],
      outputKeys: [],
      approvalMessage: "Approve to continue.",
    },
    { id: "output", name: "Output", kind: "output", description: "", inputKeys: ["payload"], outputKeys: ["payload"] },
  ],
  sampleInput: { payload: "hi" },
  expectedOutput: { payload: "hi" },
};

describe("WorkflowEngine dry-run completeness (HEL-789)", () => {
  beforeEach(async () => {
    await runStore.clear();
  });

  it("runs to completion through wait + approval without pausing", async () => {
    const run = await workflowEngine.startRun(template, { payload: "hi" }, { [DRY_RUN_KEY]: true });
    const final = await waitForCompletion(run.id);

    expect(final.status).toBe("completed");

    const waitStep = final.stepResults.find((s) => s.stepId === "wait");
    expect(waitStep?.output).toMatchObject({ skippedWait: true, waited: false });

    const approvalStep = final.stepResults.find((s) => s.stepId === "approval");
    expect(approvalStep?.output).toMatchObject({ approved: true, autoApproved: true });
    // never entered the HITL pause state
    expect(approvalStep?.status).toBe("success");
  });
});
