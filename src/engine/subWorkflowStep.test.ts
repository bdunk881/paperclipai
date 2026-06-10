/**
 * HEL-673: sub-workflow step pure helpers — unit tests.
 *
 * Covers input resolution (explicit map with {{key}} interpolation vs.
 * pass-through minus internal keys) and the nesting guard (depth cap +
 * ancestor-cycle detection).
 */

import {
  resolveSubWorkflowInput,
  nextSubWorkflowChain,
  SUB_WORKFLOW_MAX_DEPTH,
  SUB_WORKFLOW_CHAIN_KEY,
} from "./subWorkflowStep";

describe("resolveSubWorkflowInput (HEL-673)", () => {
  it("interpolates an explicit input map against the parent context", () => {
    const out = resolveSubWorkflowInput(
      { input: { lead: "{{email}}", tier: "gold", n: 3 } },
      { email: "a@b.io", other: "x" },
      "ws1",
    );
    expect(out).toEqual({ lead: "a@b.io", tier: "gold", n: 3, workspaceId: "ws1" });
  });

  it("passes the parent context through (minus internal keys) when there is no input map", () => {
    const out = resolveSubWorkflowInput(
      {},
      { a: 1, b: "two", memory: { read: () => [] }, __subWorkflowChain: ["x"], __lastError: "e" },
      "ws2",
    );
    expect(out).toEqual({ a: 1, b: "two", workspaceId: "ws2" });
  });

  it("always sets workspaceId even when the map omits it", () => {
    expect(resolveSubWorkflowInput({ input: {} }, {}, "ws3").workspaceId).toBe("ws3");
  });
});

describe("nextSubWorkflowChain (HEL-673)", () => {
  it("appends the workflow id to an empty chain", () => {
    expect(nextSubWorkflowChain({}, "wf1")).toEqual(["wf1"]);
  });

  it("extends an existing chain", () => {
    expect(nextSubWorkflowChain({ [SUB_WORKFLOW_CHAIN_KEY]: ["a", "b"] }, "c")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("throws on a cycle (target already an ancestor)", () => {
    expect(() => nextSubWorkflowChain({ [SUB_WORKFLOW_CHAIN_KEY]: ["a", "b"] }, "a")).toThrow(
      /cycle/i,
    );
  });

  it("throws when the depth cap is reached", () => {
    const full = Array.from({ length: SUB_WORKFLOW_MAX_DEPTH }, (_, i) => `wf${i}`);
    expect(() => nextSubWorkflowChain({ [SUB_WORKFLOW_CHAIN_KEY]: full }, "wfX")).toThrow(
      /max depth/i,
    );
  });
});
