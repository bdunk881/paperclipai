/**
 * HEL-693: runFromNode — run the current draft from a chosen node, reusing a
 * prior run's cached upstream outputs (matched by step id). The editor's "run
 * from here" partial run.
 */

// Prevent transitive import of the ESM-only @mistralai/mistralai package.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

import { workflowEngine } from "./WorkflowEngine";
import { runStore } from "./runStore";
import type { StepResult, WorkflowRun, WorkflowTemplate } from "../types/workflow";

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

// trigger (s0) -> output (s1) -> output (s2): all passthrough, no LLM.
const template: WorkflowTemplate = {
  id: "tpl-hel693",
  name: "HEL-693 run-from-node",
  description: "trigger -> mid -> out",
  category: "custom",
  version: "1.0.0",
  configFields: [],
  steps: [
    { id: "s0", name: "Trigger", kind: "trigger", description: "", inputKeys: [], outputKeys: ["a"] },
    { id: "s1", name: "Mid", kind: "output", description: "", inputKeys: [], outputKeys: ["mid"] },
    { id: "s2", name: "Out", kind: "output", description: "", inputKeys: [], outputKeys: ["done"] },
  ],
  sampleInput: {},
  expectedOutput: {},
};

function cached(stepId: string, stepName: string, output: Record<string, unknown>): StepResult {
  return { stepId, stepName, status: "success", output, durationMs: 1 };
}

async function seedSourceRun(id: string, results: StepResult[]): Promise<void> {
  await runStore.create({
    id,
    templateId: template.id,
    templateName: template.name,
    workspaceId: "ws-hel693",
    status: "completed",
    startedAt: new Date().toISOString(),
    input: { seeded: true },
    workflowDag: template,
    runtimeState: { config: { workspaceId: "ws-hel693" }, context: { workspaceId: "ws-hel693" }, currentStepIndex: results.length },
    stepResults: results,
  });
}

describe("WorkflowEngine.runFromNode (HEL-693)", () => {
  beforeEach(async () => {
    await runStore.clear();
  });

  it("reuses cached upstream outputs by step id and runs from the chosen node", async () => {
    await seedSourceRun("source-1", [
      cached("s0", "Trigger", { a: 1 }),
      cached("s1", "Mid", { mid: true, sentinel: "CACHED" }),
      cached("s2", "Out", { done: false }),
    ]);

    const run = await workflowEngine.runFromNode({
      template,
      fromStepId: "s2",
      sourceRunId: "source-1",
    });
    const final = await waitForCompletion(run.id);

    expect(final.status).toBe("completed");
    // upstream s0 + s1 are the cloned cache (never re-executed)
    expect(final.stepResults.find((s) => s.stepId === "s0")?.output).toMatchObject({ a: 1 });
    expect(final.stepResults.find((s) => s.stepId === "s1")?.output).toMatchObject({ sentinel: "CACHED" });
    // s2 ran fresh (its ordinal is where execution resumed)
    expect(final.runtimeState?.currentStepIndex ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("rejects running from the first step", async () => {
    await seedSourceRun("source-2", [cached("s0", "Trigger", { a: 1 })]);
    await expect(
      workflowEngine.runFromNode({ template, fromStepId: "s0", sourceRunId: "source-2" }),
    ).rejects.toThrow(/first step/i);
  });

  it("rejects an unknown step id", async () => {
    await seedSourceRun("source-3", [cached("s0", "Trigger", { a: 1 })]);
    await expect(
      workflowEngine.runFromNode({ template, fromStepId: "ghost", sourceRunId: "source-3" }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects when an upstream step has no successful cached result", async () => {
    // source run only cached s0 — s1 (upstream of s2) is missing.
    await seedSourceRun("source-4", [cached("s0", "Trigger", { a: 1 })]);
    await expect(
      workflowEngine.runFromNode({ template, fromStepId: "s2", sourceRunId: "source-4" }),
    ).rejects.toThrow(/no successful cached result/i);
  });
});
