import { describe, it, expect } from "vitest";
import { extractSelection } from "./workflowExtract";
import { STEP_NEXT_IDS_KEY } from "./workflowGraph";
import type { StepKind, WorkflowStep, WorkflowTemplate } from "../types/workflow";

function step(id: string, kind: StepKind, next: string[]): WorkflowStep {
  return {
    id,
    name: id,
    kind,
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: { [STEP_NEXT_IDS_KEY]: next },
  };
}

function template(steps: WorkflowStep[]): WorkflowTemplate {
  return {
    id: "wf",
    name: "My Flow",
    description: "",
    category: "custom",
    version: "1.0.0",
    configFields: [],
    steps,
    sampleInput: {},
    expectedOutput: {},
  };
}

const opts = {
  childWorkflowId: "child-1",
  childName: "Extracted Sub",
  subWorkflowStepId: "sub-1",
  childTriggerId: "ct-1",
};

function nextOf(t: WorkflowTemplate, id: string): string[] {
  const s = t.steps.find((x) => x.id === id);
  return (s?.config?.[STEP_NEXT_IDS_KEY] as string[] | undefined) ?? [];
}

describe("extractSelection", () => {
  // trigger(t) → a → b → c(output)
  const linear = () =>
    template([
      step("t", "trigger", ["a"]),
      step("a", "llm", ["b"]),
      step("b", "action", ["c"]),
      step("c", "output", []),
    ]);

  it("extracts a contiguous middle run (single entry + single exit)", () => {
    const res = extractSelection({ template: linear(), selectedIds: ["a", "b"], ...opts });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Parent: t → sub-1 → c, with a/b gone.
    expect(res.parent.steps.map((s) => s.id)).toEqual(["t", "sub-1", "c"]);
    expect(nextOf(res.parent, "t")).toEqual(["sub-1"]); // in-edge rewired
    const sub = res.parent.steps.find((s) => s.id === "sub-1");
    expect(sub?.kind).toBe("sub_workflow");
    expect(sub?.config?.workflowId).toBe("child-1");
    expect(nextOf(res.parent, "sub-1")).toEqual(["c"]); // single exit carried

    // Child: sub_workflow_trigger → a → b, with b's external edge to c dropped.
    expect(res.child.id).toBe("child-1");
    expect(res.child.name).toBe("Extracted Sub");
    expect(res.child.steps.map((s) => s.id)).toEqual(["ct-1", "a", "b"]);
    expect(res.child.steps[0].kind).toBe("sub_workflow_trigger");
    expect(nextOf(res.child, "ct-1")).toEqual(["a"]);
    expect(nextOf(res.child, "a")).toEqual(["b"]);
    expect(nextOf(res.child, "b")).toEqual([]); // b → c stripped (c is external)
  });

  it("extracts a single middle step", () => {
    const res = extractSelection({ template: linear(), selectedIds: ["b"], ...opts });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.parent.steps.map((s) => s.id)).toEqual(["t", "a", "sub-1", "c"]);
    expect(nextOf(res.parent, "a")).toEqual(["sub-1"]);
    expect(nextOf(res.parent, "sub-1")).toEqual(["c"]);
    expect(res.child.steps.map((s) => s.id)).toEqual(["ct-1", "b"]);
    expect(nextOf(res.child, "b")).toEqual([]);
  });

  it("extracts a tail run (no exit target)", () => {
    const res = extractSelection({ template: linear(), selectedIds: ["b", "c"], ...opts });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(nextOf(res.parent, "sub-1")).toEqual([]); // tail → no downstream
    expect(res.child.steps.map((s) => s.id)).toEqual(["ct-1", "b", "c"]);
  });

  it("handles a template with implicit linear edges (no explicit adjacency)", () => {
    // No step carries STEP_NEXT_IDS_KEY → buildEdgesFromSteps falls back to
    // linear order (t → a → b → c). extractSelection must normalize first.
    const bare = (id: string, kind: StepKind): WorkflowStep => ({
      id,
      name: id,
      kind,
      description: "",
      inputKeys: [],
      outputKeys: [],
      config: {},
    });
    const t = template([
      bare("t", "trigger"),
      bare("a", "llm"),
      bare("b", "action"),
      bare("c", "output"),
    ]);
    const res = extractSelection({ template: t, selectedIds: ["a", "b"], ...opts });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.parent.steps.map((s) => s.id)).toEqual(["t", "sub-1", "c"]);
    expect(nextOf(res.parent, "t")).toEqual(["sub-1"]);
    expect(nextOf(res.parent, "sub-1")).toEqual(["c"]);
    expect(res.child.steps.map((s) => s.id)).toEqual(["ct-1", "a", "b"]);
  });

  it("rejects an empty selection", () => {
    const res = extractSelection({ template: linear(), selectedIds: [], ...opts });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/at least one/i);
  });

  it("rejects a selection containing a trigger", () => {
    const res = extractSelection({ template: linear(), selectedIds: ["t", "a"], ...opts });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/trigger/i);
  });

  it("rejects an unknown step id", () => {
    const res = extractSelection({ template: linear(), selectedIds: ["zzz"], ...opts });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/no longer exists/i);
  });

  it("rejects a selection with multiple exit points", () => {
    // a fans out to b (internal) and x (external); b → c (external). Selecting
    // [a, b] yields two external targets {x, c}.
    const t = template([
      step("t", "trigger", ["a"]),
      step("a", "condition", ["b", "x"]),
      step("b", "action", ["c"]),
      step("x", "action", []),
      step("c", "output", []),
    ]);
    const res = extractSelection({ template: t, selectedIds: ["a", "b"], ...opts });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/exit/i);
  });

  it("rejects a selection with multiple entry points", () => {
    // both a and b are targeted from outside (t → a, t → b); selecting [a, b]
    // where neither points to the other yields two entry steps.
    const t = template([
      step("t", "trigger", ["a", "b"]),
      step("a", "action", ["c"]),
      step("b", "action", ["c"]),
      step("c", "output", []),
    ]);
    const res = extractSelection({ template: t, selectedIds: ["a", "b"], ...opts });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/entry/i);
  });
});
