/**
 * HEL-489: WorkflowEngine emits run.lifecycle SSE events for DAG runs so the
 * RunTray + routine streams advance live (the agent-prompt path already did;
 * the DAG path was silent).
 */

// Prevent transitive import of the ESM-only @mistralai/mistralai package.
jest.mock("./llmProviders", () => ({ getProvider: jest.fn() }));

import { WorkflowEngine } from "./WorkflowEngine";
import { runStore } from "./runStore";
import {
  subscribeAgentStreamInMemory,
  resetWorkspaceStreamForTests,
  type RunLifecycleEvent,
} from "./agentTrace/streamPublisher";
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

// Minimal trigger → output template (passthrough kinds, no LLM) so the run
// completes deterministically without a provider.
const tinyTemplate: WorkflowTemplate = {
  id: "tpl-hel489-lifecycle",
  name: "HEL-489 lifecycle test",
  description: "trigger → output passthrough",
  category: "custom",
  version: "1.0.0",
  configFields: [],
  steps: [
    {
      id: "trigger",
      name: "Trigger",
      kind: "trigger",
      description: "start",
      inputKeys: [],
      outputKeys: ["payload"],
    },
    {
      id: "output",
      name: "Output",
      kind: "output",
      description: "done",
      inputKeys: ["payload"],
      outputKeys: ["payload"],
    },
  ],
  sampleInput: { payload: "hi" },
  expectedOutput: { payload: "hi" },
};

describe("WorkflowEngine run.lifecycle SSE (HEL-489)", () => {
  beforeEach(() => {
    void runStore.clear();
    resetWorkspaceStreamForTests();
  });

  it("emits started + completed run.lifecycle events for a DAG run", async () => {
    const workspaceId = "ws-hel489";
    const events: RunLifecycleEvent[] = [];
    const unsubscribe = subscribeAgentStreamInMemory(workspaceId, (envelope) => {
      if (envelope.event.kind === "run.lifecycle") {
        events.push(envelope.event);
      }
    });

    const engine = new WorkflowEngine();
    const run = await engine.startRun(tinyTemplate, { payload: "hi", workspaceId });
    await waitForCompletion(run.id);
    // The lifecycle emits are fire-and-forget; let the microtasks flush.
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsubscribe();

    const phases = events.map((e) => e.phase);
    expect(phases).toContain("started");
    expect(phases).toContain("completed");
    // Every event targets this run so the RunTray can match it.
    expect(events.every((e) => e.runId === run.id)).toBe(true);
  });

  it("does not publish to another workspace's stream", async () => {
    const otherEvents: RunLifecycleEvent[] = [];
    const unsubscribe = subscribeAgentStreamInMemory("ws-other", (envelope) => {
      if (envelope.event.kind === "run.lifecycle") {
        otherEvents.push(envelope.event);
      }
    });

    const engine = new WorkflowEngine();
    const run = await engine.startRun(tinyTemplate, { payload: "hi", workspaceId: "ws-hel489" });
    await waitForCompletion(run.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsubscribe();

    expect(otherEvents).toHaveLength(0);
  });
});
