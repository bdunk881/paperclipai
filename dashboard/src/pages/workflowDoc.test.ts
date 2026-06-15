import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { WorkflowStep } from "../types/workflow";
import { STEP_NEXT_IDS_KEY, STEP_POSITION_KEY } from "./workflowGraph";
import {
  applyStepsToDoc,
  getGraphRoot,
  isGraphSeeded,
  LOCAL_ORIGIN,
  readSteps,
  seedGraphFromSteps,
  STEP_NAME_YMAP_KEY,
} from "./workflowDoc";

function step(id: string, over: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name: id,
    kind: "output",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: {},
    ...over,
  };
}

function withPos(s: WorkflowStep, x: number, y: number, next?: string[]): WorkflowStep {
  const config: Record<string, unknown> = {
    ...(s.config ?? {}),
    [STEP_POSITION_KEY]: { x, y },
  };
  if (next) config[STEP_NEXT_IDS_KEY] = next;
  return { ...s, config };
}

describe("workflowDoc (HEL-795 A3a)", () => {
  it("round-trips steps through the doc (positions, adjacency, top-level fields, cfg)", () => {
    const doc = new Y.Doc();
    const steps: WorkflowStep[] = [
      withPos(step("s0", { kind: "trigger", outputKeys: ["a"] }), 10, 20, ["s1"]),
      withPos(
        step("s1", {
          kind: "llm",
          description: "do a thing",
          promptTemplate: "hi {{a}}",
          config: { temperature: 0.5, nested: { deep: true } },
        }),
        100,
        200,
        ["s2"],
      ),
      withPos(step("s2", { kind: "output" }), 300, 400, []),
    ];
    applyStepsToDoc(doc, steps);
    const out = readSteps(doc);

    expect(out.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(out).toEqual(steps); // deep equality incl. config position + next + cfg
  });

  it("preserves implicit-linear adjacency (no step carries __uiNextStepIds)", () => {
    const doc = new Y.Doc();
    // No step has __uiNextStepIds — the implicit-linear case.
    const steps = [
      withPos(step("s0", { kind: "trigger" }), 0, 0),
      withPos(step("s1", { kind: "output" }), 0, 80),
    ];
    applyStepsToDoc(doc, steps);
    const out = readSteps(doc);
    // The key must NOT be re-added — else buildEdgesFromSteps stops falling back
    // to implicit-linear and the chain vanishes.
    expect(STEP_NEXT_IDS_KEY in (out[0].config ?? {})).toBe(false);
    expect(STEP_NEXT_IDS_KEY in (out[1].config ?? {})).toBe(false);
    expect(out).toEqual(steps);
  });

  it("diffs by id: add, remove, reorder", () => {
    const doc = new Y.Doc();
    applyStepsToDoc(doc, [step("a"), step("b"), step("c")]);
    // Remove b, add d, reorder to [c, a, d].
    applyStepsToDoc(doc, [step("c"), step("a"), step("d")]);
    expect(readSteps(doc).map((s) => s.id)).toEqual(["c", "a", "d"]);
  });

  it("updates a step's cfg field-by-field without dropping unrelated fields", () => {
    const doc = new Y.Doc();
    applyStepsToDoc(doc, [step("s1", { config: { a: 1, b: 2 } })]);
    const cfgMapBefore = (
      (getGraphRoot(doc).get("steps") as Y.Map<Y.Map<unknown>>).get("s1") as Y.Map<unknown>
    ).get("cfg") as Y.Map<unknown>;
    applyStepsToDoc(doc, [step("s1", { config: { a: 9, b: 2 } })]);
    const cfgMapAfter = (
      (getGraphRoot(doc).get("steps") as Y.Map<Y.Map<unknown>>).get("s1") as Y.Map<unknown>
    ).get("cfg") as Y.Map<unknown>;
    // Same nested Y.Map identity is reused (field-level merge, not wholesale swap).
    expect(cfgMapAfter).toBe(cfgMapBefore);
    expect(readSteps(doc)[0].config).toMatchObject({ a: 9, b: 2 });
  });

  it("removes cfg keys that are no longer present", () => {
    const doc = new Y.Doc();
    applyStepsToDoc(doc, [step("s1", { config: { a: 1, gone: true } })]);
    applyStepsToDoc(doc, [step("s1", { config: { a: 1 } })]);
    // No adjacency key on the input step → readback omits it (absent-vs-empty).
    expect(readSteps(doc)[0].config).toEqual({ a: 1 });
  });

  it("prefers the live stepNames Y.Text over the name leaf", () => {
    const doc = new Y.Doc();
    applyStepsToDoc(doc, [step("s1", { name: "Leaf name" })]);
    const names = doc.getMap<Y.Text>(STEP_NAME_YMAP_KEY);
    const t = new Y.Text();
    t.insert(0, "Live name");
    doc.transact(() => names.set("s1", t));
    expect(readSteps(doc)[0].name).toBe("Live name");
  });

  it("seeds once and is idempotent under a second (concurrent) seed", () => {
    const doc = new Y.Doc();
    const steps = [step("a"), step("b")];
    expect(seedGraphFromSteps(doc, steps)).toBe(true);
    expect(isGraphSeeded(doc)).toBe(true);
    // A reconnect / second client re-seeding must be a no-op.
    expect(seedGraphFromSteps(doc, [step("x"), step("y"), step("z")])).toBe(false);
    expect(readSteps(doc).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("tags local writes with LOCAL_ORIGIN and seeds with SEED_ORIGIN", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    seedGraphFromSteps(doc, [step("a")]);
    applyStepsToDoc(doc, [step("a"), step("b")]);
    // First transaction is the seed, second is the local apply.
    expect(origins[0]).toBe("wf-builder-seed");
    expect((origins[1] as { source?: string } | null)?.source).toBe("wf-builder-local");
  });
});

describe("Y.UndoManager over the graph (HEL-795 A3b)", () => {
  function manager(doc: Y.Doc): Y.UndoManager {
    return new Y.UndoManager(getGraphRoot(doc), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
  }

  it("undoes and redoes a local graph edit", () => {
    const doc = new Y.Doc();
    seedGraphFromSteps(doc, [step("a")]);
    const um = manager(doc);
    applyStepsToDoc(doc, [step("a"), step("b")]); // add b under LOCAL_ORIGIN
    expect(readSteps(doc).map((s) => s.id)).toEqual(["a", "b"]);
    um.undo();
    expect(readSteps(doc).map((s) => s.id)).toEqual(["a"]);
    um.redo();
    expect(readSteps(doc).map((s) => s.id)).toEqual(["a", "b"]);
    um.destroy();
  });

  it("does NOT track the seed (SEED_ORIGIN) — undo can't wipe a freshly seeded graph", () => {
    const doc = new Y.Doc();
    const um = manager(doc);
    seedGraphFromSteps(doc, [step("a"), step("b")]); // SEED_ORIGIN, untracked
    expect(um.canUndo()).toBe(false);
    um.undo(); // no-op
    expect(readSteps(doc).map((s) => s.id)).toEqual(["a", "b"]);
    um.destroy();
  });

  it("does NOT track a remote (foreign-origin) edit — never undo a collaborator's change", () => {
    const doc = new Y.Doc();
    seedGraphFromSteps(doc, [step("a")]);
    const um = manager(doc);
    applyStepsToDoc(doc, [step("a"), step("b")], "remote-peer");
    expect(um.canUndo()).toBe(false);
    um.destroy();
  });
});

describe("doc <-> dag serializer round-trip (HEL-797 A5)", () => {
  // handleSave persists readSteps(doc) (the projection); a reload seeds a fresh
  // doc from the saved dag.steps. These prove that Save -> reload is lossless.
  it("Save -> reload preserves the full graph (read doc A, seed fresh doc B)", () => {
    const docA = new Y.Doc();
    const steps = [
      withPos(step("s0", { kind: "trigger", outputKeys: ["a"] }), 10, 20, ["s1"]),
      withPos(
        step("s1", { kind: "llm", promptTemplate: "x {{a}}", config: { temperature: 0.3 } }),
        100,
        200,
        ["s2"],
      ),
      withPos(step("s2", { kind: "output" }), 300, 400, []),
    ];
    applyStepsToDoc(docA, steps);
    const saved = readSteps(docA);

    const docB = new Y.Doc();
    seedGraphFromSteps(docB, saved);
    expect(readSteps(docB)).toEqual(saved);
    expect(readSteps(docB)).toEqual(steps);
  });

  it("single-step workflow with no edges round-trips without spurious adjacency", () => {
    const docA = new Y.Doc();
    const steps = [withPos(step("only", { kind: "trigger" }), 0, 0)]; // no __uiNextStepIds
    applyStepsToDoc(docA, steps);
    const saved = readSteps(docA);

    const docB = new Y.Doc();
    seedGraphFromSteps(docB, saved);
    const out = readSteps(docB);
    expect(STEP_NEXT_IDS_KEY in (out[0].config ?? {})).toBe(false);
    expect(out).toEqual(steps);
  });

  it("explicit empty-next (e.g. an output node) round-trips as [] not absent", () => {
    const docA = new Y.Doc();
    const steps = [withPos(step("out", { kind: "output" }), 0, 0, [])]; // explicit []
    applyStepsToDoc(docA, steps);
    const saved = readSteps(docA);
    expect((saved[0].config as Record<string, unknown>)[STEP_NEXT_IDS_KEY]).toEqual([]);

    const docB = new Y.Doc();
    seedGraphFromSteps(docB, saved);
    expect(readSteps(docB)).toEqual(steps);
  });
});
