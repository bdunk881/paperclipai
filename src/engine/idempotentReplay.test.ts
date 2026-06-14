/**
 * HEL-696: idempotentReplay — unit tests for the pure replay policy.
 */
import { shouldReuseStepKind, buildPriorResultMap } from "./idempotentReplay";
import type { StepResult } from "../types/workflow";

function result(partial: Partial<StepResult> & Pick<StepResult, "stepId">): StepResult {
  return {
    stepName: partial.stepId,
    status: "success",
    output: {},
    durationMs: 1,
    ...partial,
  };
}

describe("shouldReuseStepKind", () => {
  it("reuses side-effecting / pausing / nondeterministic kinds", () => {
    for (const k of ["action", "mcp", "agent", "llm", "knowledge", "sub_workflow", "wait", "approval"] as const) {
      expect(shouldReuseStepKind(k)).toBe(true);
    }
  });

  it("re-runs pure + control-flow kinds (so loop/switch reproduce jumps)", () => {
    for (const k of ["trigger", "transform", "condition", "filter", "merge", "output", "stop_error", "loop", "switch"] as const) {
      expect(shouldReuseStepKind(k)).toBe(false);
    }
  });
});

describe("buildPriorResultMap", () => {
  it("maps successful rows by idempotency key", () => {
    const map = buildPriorResultMap([
      result({ stepId: "a", idempotencyKey: "k-a", output: { x: 1 } }),
      result({ stepId: "b", idempotencyKey: "k-b", output: { y: 2 } }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("k-a")?.output).toEqual({ x: 1 });
    expect(map.get("k-b")?.output).toEqual({ y: 2 });
  });

  it("excludes rows without a key and non-success rows", () => {
    const map = buildPriorResultMap([
      result({ stepId: "ok", idempotencyKey: "k-ok" }),
      result({ stepId: "nokey" }), // no idempotencyKey
      result({ stepId: "failed", idempotencyKey: "k-failed", status: "failure" }),
      result({ stepId: "running", idempotencyKey: "k-running", status: "running" }),
    ]);
    expect([...map.keys()]).toEqual(["k-ok"]);
  });

  it("handles undefined / empty input", () => {
    expect(buildPriorResultMap(undefined).size).toBe(0);
    expect(buildPriorResultMap([]).size).toBe(0);
  });
});
