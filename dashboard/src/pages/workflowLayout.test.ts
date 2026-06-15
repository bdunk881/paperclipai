import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import type { WorkflowStep } from "../types/workflow";
import { tidyLayout, DEFAULT_NODE_DIMS } from "./workflowLayout";

function step(id: string): WorkflowStep {
  return { id, name: id, kind: "transform", config: {} } as WorkflowStep;
}
function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target } as Edge;
}

describe("tidyLayout (HEL-682)", () => {
  it("returns an empty map for no steps", () => {
    expect(tidyLayout([], []).size).toBe(0);
  });

  it("stacks a linear chain top-to-bottom (increasing y, one rank each)", () => {
    const steps = [step("a"), step("b"), step("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const pos = tidyLayout(steps, edges);

    expect(pos.size).toBe(3);
    const a = pos.get("a")!;
    const b = pos.get("b")!;
    const c = pos.get("c")!;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    // Integer top-left coordinates.
    for (const p of [a, b, c]) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });

  it("places sibling branches on the same rank, separated horizontally", () => {
    const steps = [step("t"), step("a"), step("b")];
    const edges = [edge("t", "a"), edge("t", "b")];
    const pos = tidyLayout(steps, edges);

    const a = pos.get("a")!;
    const b = pos.get("b")!;
    expect(a.y).toBe(b.y); // same rank below the trigger
    expect(a.x).not.toBe(b.x); // spread apart
    expect(pos.get("t")!.y).toBeLessThan(a.y);
  });

  it("is deterministic for the same input", () => {
    const steps = [step("a"), step("b")];
    const edges = [edge("a", "b")];
    expect(JSON.stringify([...tidyLayout(steps, edges)])).toBe(
      JSON.stringify([...tidyLayout(steps, edges)]),
    );
  });

  it("honours measured node dimensions (taller nodes push the next rank down)", () => {
    const steps = [step("a"), step("b")];
    const edges = [edge("a", "b")];
    const tall = new Map([["a", { width: DEFAULT_NODE_DIMS.width, height: 400 }]]);
    const def = tidyLayout(steps, edges);
    const withTall = tidyLayout(steps, edges, tall);
    // A taller first node pushes b further down than with default dims.
    expect(withTall.get("b")!.y).toBeGreaterThan(def.get("b")!.y);
  });
});
