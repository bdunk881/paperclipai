/**
 * HEL-696: idempotent replay — a run replayed from the top (a BullMQ retry, or
 * the HEL-695 reaper re-enqueuing a stranded run) must NOT re-fire steps that
 * already completed. This proves an `action` step with a recorded success row is
 * reused (its recorded output returned) instead of re-executing the connector.
 */

// Prevent transitive import of the ESM-only @mistralai/mistralai package.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

import { workflowEngine } from "./WorkflowEngine";
import { runStore } from "./runStore";
import { deriveIdempotencyKey } from "../queue/withIdempotency";
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

// trigger (ordinal 0) → action (ordinal 1) → output (ordinal 2).
const template: WorkflowTemplate = {
  id: "tpl-hel696-replay",
  name: "HEL-696 idempotent replay",
  description: "trigger -> action -> output",
  category: "custom",
  version: "1.0.0",
  configFields: [],
  steps: [
    { id: "trigger", name: "Trigger", kind: "trigger", description: "", inputKeys: [], outputKeys: [] },
    {
      id: "act",
      name: "Side effect",
      kind: "action",
      description: "",
      inputKeys: [],
      outputKeys: ["result"],
      action: "test.noop",
    },
    { id: "out", name: "Output", kind: "output", description: "", inputKeys: [], outputKeys: [] },
  ],
  sampleInput: {},
  expectedOutput: {},
};

const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("WorkflowEngine idempotent replay (HEL-696)", () => {
  beforeEach(async () => {
    await runStore.clear();
  });

  it("reuses a completed action step's recorded output instead of re-executing it", async () => {
    // Seed a run as if a prior attempt completed the `action` (ordinal 1) and
    // recorded its idempotency key, then crashed. The reaper would flip it to
    // `queued`; here we seed it `queued` directly.
    const actionKey = deriveIdempotencyKey(RUN_ID, 1);
    await runStore.create({
      id: RUN_ID,
      templateId: template.id,
      templateName: template.name,
      workspaceId: "ws-hel696",
      status: "queued",
      startedAt: new Date().toISOString(),
      input: {},
      workflowDag: template,
      runtimeState: { config: { workspaceId: "ws-hel696" }, context: { workspaceId: "ws-hel696" }, currentStepIndex: 0 },
      stepResults: [
        {
          stepId: "act",
          stepName: "Side effect",
          status: "success",
          output: { result: "FROM_PRIOR_ATTEMPT", sentinel: true },
          durationMs: 5,
          idempotencyKey: actionKey,
        },
      ],
    });

    await workflowEngine.executeQueuedRun(RUN_ID);
    const final = await waitForCompletion(RUN_ID);

    expect(final.status).toBe("completed");
    const actionResult = final.stepResults.find((s) => s.stepId === "act");
    // Reused the recorded output (connector NOT re-invoked) + flagged as replay.
    expect(actionResult?.output).toMatchObject({ sentinel: true, idempotentReplay: true });
    expect(actionResult?.status).toBe("success");
  });

  it("does not reuse on a first run (empty prior map) — executes normally", async () => {
    // No prior step_results → buildPriorResultMap empty → the action executes
    // (here `test.noop` resolves to a no-op connector output, no sentinel).
    await runStore.create({
      id: RUN_ID,
      templateId: template.id,
      templateName: template.name,
      workspaceId: "ws-hel696",
      status: "queued",
      startedAt: new Date().toISOString(),
      input: {},
      workflowDag: template,
      runtimeState: { config: { workspaceId: "ws-hel696" }, context: { workspaceId: "ws-hel696" }, currentStepIndex: 0 },
      stepResults: [],
    });

    await workflowEngine.executeQueuedRun(RUN_ID);
    const final = await waitForCompletion(RUN_ID);

    const actionResult = final.stepResults.find((s) => s.stepId === "act");
    expect(actionResult?.output).not.toMatchObject({ idempotentReplay: true });
    // every step records its idempotency key now
    expect(actionResult?.idempotencyKey).toBe(deriveIdempotencyKey(RUN_ID, 1));
  });
});
