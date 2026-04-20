import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types/workflow";
import {
  buildEdgesFromSteps,
  insertStepAfterTarget,
  serializeEdgesToSteps,
  validateEdgeCandidate,
  validateGraphTopology,
} from "./workflowGraph";

function makeStep(
  id: string,
  kind: WorkflowStep["kind"],
  name = id,
): WorkflowStep {
  return {
    id,
    name,
    kind,
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: {},
  };
}

describe("workflowGraph", () => {
  it("builds sequential edges when no serialized graph is present", () => {
    const steps = [makeStep("a", "trigger"), makeStep("b", "action"), makeStep("c", "output")];
    const edges = buildEdgesFromSteps(steps);

    expect(edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(["a->b", "b->c"]);
  });

  it("round-trips serialized edges from step config", () => {
    const steps = [makeStep("a", "trigger"), makeStep("b", "condition"), makeStep("c", "output")];
    const serialized = serializeEdgesToSteps(steps, [
      { id: "a-->b", source: "a", target: "b" },
      { id: "b-->c", source: "b", target: "c" },
    ]);
    const edges = buildEdgesFromSteps(serialized);

    expect(edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(["a->b", "b->c"]);
    expect(serialized[0].config?.__uiNextStepIds).toEqual(["b"]);
    expect(serialized[1].config?.__uiNextStepIds).toEqual(["c"]);
    expect(serialized[2].config?.__uiNextStepIds).toEqual([]);
  });

  it("rejects invalid edge candidates", () => {
    const steps = [makeStep("a", "trigger"), makeStep("b", "action"), makeStep("c", "output")];
    const edges = [{ id: "a-->b", source: "a", target: "b" }];

    expect(
      validateEdgeCandidate({ sourceId: "a", targetId: "a", steps, edges }).valid,
    ).toBe(false);
    expect(
      validateEdgeCandidate({ sourceId: "b", targetId: "a", steps, edges }).valid,
    ).toBe(false);
    expect(
      validateEdgeCandidate({ sourceId: "c", targetId: "b", steps, edges }).valid,
    ).toBe(false);
    expect(
      validateEdgeCandidate({ sourceId: "a", targetId: "b", steps, edges }).valid,
    ).toBe(false);
  });

  it("rejects cycle-producing edge candidates", () => {
    const steps = [makeStep("a", "trigger"), makeStep("b", "action"), makeStep("c", "action")];
    const edges = [
      { id: "a-->b", source: "a", target: "b" },
      { id: "c-->a", source: "c", target: "a" },
    ];

    const result = validateEdgeCandidate({ sourceId: "b", targetId: "c", steps, edges });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/cycle/i);
    }
  });

  it("validates trigger reachability and disconnected nodes", () => {
    const connected = [makeStep("a", "trigger"), makeStep("b", "action"), makeStep("c", "output")];
    const connectedEdges = [
      { id: "a-->b", source: "a", target: "b" },
      { id: "b-->c", source: "b", target: "c" },
    ];
    expect(validateGraphTopology(connected, connectedEdges)).toBeNull();

    const disconnected = [makeStep("a", "trigger"), makeStep("b", "action"), makeStep("c", "output")];
    const disconnectedEdges = [{ id: "a-->b", source: "a", target: "b" }];
    expect(validateGraphTopology(disconnected, disconnectedEdges)).toMatch(/not reachable/i);
  });

  it("rewires serialized successors when inserting a step after a target", () => {
    const trigger = {
      ...makeStep("trigger", "trigger"),
      config: { __uiPosition: { x: 80, y: 64 } },
    };
    const detour = {
      ...makeStep("detour", "action"),
      config: { __uiPosition: { x: 80, y: 254 } },
    };
    const llm = {
      ...makeStep("llm", "llm"),
      config: { __uiPosition: { x: 80, y: 444 } },
    };

    const serialized = serializeEdgesToSteps([trigger, detour, llm], [
      { id: "trigger-->llm", source: "trigger", target: "llm" },
    ]);

    const inserted = insertStepAfterTarget({
      steps: serialized,
      targetStepId: "trigger",
      insertedStep: makeStep("notify", "action", "Send Slack Notification"),
      gapY: 190,
      fallbackPosition: { x: 80, y: 254 },
    });

    expect(inserted.map((step) => step.id)).toEqual(["trigger", "notify", "detour", "llm"]);
    expect(inserted[1].config?.__uiPosition).toEqual({ x: 80, y: 254 });
    expect(inserted[2].config?.__uiPosition).toEqual({ x: 80, y: 444 });
    expect(inserted[3].config?.__uiPosition).toEqual({ x: 80, y: 634 });
    expect(inserted[0].config?.__uiNextStepIds).toEqual(["notify"]);
    expect(inserted[1].config?.__uiNextStepIds).toEqual(["llm"]);
    expect(inserted[3].config?.__uiNextStepIds).toEqual([]);
  });
});
