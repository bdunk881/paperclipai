import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../types/workflow";
import {
  buildEdgesFromSteps,
  extractClipboard,
  makeStepId,
  pasteClipboard,
  serializeEdgesToSteps,
  STEP_POSITION_KEY,
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

describe("copy / paste (HEL-686)", () => {
  function positioned(id: string, kind: WorkflowStep["kind"], x: number, y: number): WorkflowStep {
    return { ...makeStep(id, kind), config: { [STEP_POSITION_KEY]: { x, y } } };
  }
  function edgeKeys(steps: WorkflowStep[]): string[] {
    return buildEdgesFromSteps(steps)
      .map((e) => `${e.source}->${e.target}`)
      .sort();
  }
  function deterministicIds(): () => string {
    let n = 0;
    return () => `new-${++n}`;
  }

  it("extracts the selected steps (deep-cloned) + only the internal edges", () => {
    const steps = [
      positioned("t", "trigger", 0, 0),
      positioned("a", "transform", 0, 100),
      positioned("b", "action", 0, 200),
    ];
    const clip = extractClipboard(steps, ["a", "b"]);

    expect(clip.steps.map((s) => s.id)).toEqual(["a", "b"]);
    // a->b is internal; t->a is dropped (t not selected).
    expect(clip.internalEdges.map((e) => `${e.source}->${e.target}`)).toEqual(["a->b"]);
    // Deep clone — mutating the clipboard must not touch the source.
    expect(clip.steps[0]).not.toBe(steps[1]);
  });

  it("pastes an island: fresh ids, offset positions, internal edges preserved, existing graph intact", () => {
    const steps = [
      positioned("t", "trigger", 0, 0),
      positioned("a", "transform", 10, 100),
      positioned("b", "action", 10, 200),
    ];
    const clip = extractClipboard(steps, ["a", "b"]);
    const { steps: next, pastedIds } = pasteClipboard(steps, clip, deterministicIds());

    expect(next).toHaveLength(5);
    expect(pastedIds).toEqual(["new-1", "new-2"]);

    const keys = edgeKeys(next);
    // Existing edges preserved + the remapped internal edge; no cross edges.
    expect(keys).toContain("t->a");
    expect(keys).toContain("a->b");
    expect(keys).toContain("new-1->new-2");
    for (const k of keys) {
      const [src, dst] = k.split("->");
      const srcPasted = src.startsWith("new-");
      const dstPasted = dst.startsWith("new-");
      expect(srcPasted).toBe(dstPasted); // never bridges existing <-> pasted
    }

    // Offset by the default 48 from the originals.
    const pastedA = next.find((s) => s.id === "new-1")!;
    expect(pastedA.config?.[STEP_POSITION_KEY]).toEqual({ x: 58, y: 148 });
  });

  it("pastes a single disconnected node with no internal edges", () => {
    const steps = [makeStep("t", "trigger"), makeStep("a", "transform")];
    const clip = extractClipboard(steps, ["a"]);
    expect(clip.internalEdges).toHaveLength(0);

    const { steps: next, pastedIds } = pasteClipboard(steps, clip, deterministicIds());
    expect(next).toHaveLength(3);
    expect(pastedIds).toHaveLength(1);
    // Existing edge preserved; the pasted node is an island (no edges).
    expect(edgeKeys(next)).toEqual(["t->a"]);
  });

  it("is a no-op for an empty clipboard", () => {
    const steps = [makeStep("a", "trigger")];
    const result = pasteClipboard(steps, { steps: [], internalEdges: [] }, deterministicIds());
    expect(result.pastedIds).toEqual([]);
    expect(result.steps).toBe(steps);
  });
});
