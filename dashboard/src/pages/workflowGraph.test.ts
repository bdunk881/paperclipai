import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types/workflow";
import {
  buildEdgesFromSteps,
  makeStepId,
  serializeEdgesToSteps,
  validateEdgeCandidate,
  validateGraphTopology,
} from "./workflowGraph";

describe("makeStepId (HEL-793)", () => {
  it("mints unique, step-prefixed ids across a tight loop (no Date.now() collisions)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeStepId());
    expect(ids.size).toBe(1000);
    expect([...ids].every((id) => id.startsWith("step-"))).toBe(true);
  });
});

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

  it("allows multiple incoming edges into a Merge step but not other kinds (HEL-667)", () => {
    // A non-merge step still rejects a second incoming edge.
    const baseSteps = [makeStep("t", "trigger"), makeStep("x", "action"), makeStep("a", "action")];
    const oneIncoming = [{ id: "t-->a", source: "t", target: "a" }];
    expect(
      validateEdgeCandidate({ sourceId: "x", targetId: "a", steps: baseSteps, edges: oneIncoming }).valid,
    ).toBe(false);

    // A Merge step accepts the second incoming edge — branches can rejoin.
    const mergeSteps = [makeStep("t", "trigger"), makeStep("x", "action"), makeStep("m", "merge")];
    const intoMerge = [{ id: "t-->m", source: "t", target: "m" }];
    expect(
      validateEdgeCandidate({ sourceId: "x", targetId: "m", steps: mergeSteps, edges: intoMerge }).valid,
    ).toBe(true);
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
});
