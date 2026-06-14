/**
 * HEL-776: evalScorer — unit tests for the pure scorer.
 */

import {
  deepEqual,
  compareEvalOutput,
  matchValue,
  buildEvalRows,
  summarizeEval,
  type ScorableRun,
} from "./evalScorer";

describe("deepEqual", () => {
  it("compares primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("compares nested objects order-independently", () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("compares arrays order-sensitively", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 2 }] })).toBe(true);
  });

  it("distinguishes arrays from objects", () => {
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("compareEvalOutput", () => {
  it("passes on an exact match", () => {
    expect(compareEvalOutput({ label: "billing" }, { label: "billing" })).toEqual({
      pass: true,
      mismatches: [],
    });
  });

  it("passes on a subset match (actual has extra keys)", () => {
    const r = compareEvalOutput(
      { label: "billing", confidence: 0.9, raw: "..." },
      { label: "billing" },
    );
    expect(r.pass).toBe(true);
  });

  it("fails and reports each mismatched key", () => {
    const r = compareEvalOutput({ label: "sales", priority: "low" }, { label: "billing", priority: "high" });
    expect(r.pass).toBe(false);
    expect(r.mismatches).toEqual([
      { key: "label", expected: "billing", actual: "sales" },
      { key: "priority", expected: "high", actual: "low" },
    ]);
  });

  it("fails when an expected key is missing from actual", () => {
    const r = compareEvalOutput({ label: "billing" }, { label: "billing", route: "team-a" });
    expect(r.pass).toBe(false);
    expect(r.mismatches).toEqual([{ key: "route", expected: "team-a", actual: undefined }]);
  });

  it("matches nested objects and arrays", () => {
    expect(compareEvalOutput({ tags: ["a", "b"], meta: { ok: true } }, { tags: ["a", "b"], meta: { ok: true } }).pass).toBe(true);
    expect(compareEvalOutput({ tags: ["b", "a"] }, { tags: ["a", "b"] }).pass).toBe(false);
  });

  it("passes vacuously when expected is empty / missing", () => {
    expect(compareEvalOutput({ anything: 1 }, {}).pass).toBe(true);
    expect(compareEvalOutput(undefined, undefined).pass).toBe(true);
    expect(compareEvalOutput(null, { x: 1 }).pass).toBe(false);
  });
});

describe("buildEvalRows", () => {
  const runsById = new Map<string, ScorableRun>([
    ["r0", { status: "completed", output: { label: "billing" } }],
    ["r1", { status: "completed", output: { label: "sales" } }],
    ["r2", { status: "queued" }],
    ["r3", { status: "failed", output: {}, error: "boom" }],
  ]);

  it("scores terminal runs against expected by batch order; leaves in-flight pending", () => {
    const rows = buildEvalRows(
      ["r0", "r1", "r2", "r3"],
      [{ label: "billing" }, { label: "billing" }, { label: "x" }, { label: "y" }],
      runsById,
    );

    expect(rows[0]).toMatchObject({ index: 0, runId: "r0", status: "completed", pass: true });
    expect(rows[1]).toMatchObject({ runId: "r1", pass: false });
    expect(rows[1]!.mismatches).toEqual([{ key: "label", expected: "billing", actual: "sales" }]);
    // queued → pending (not scored)
    expect(rows[2]).toMatchObject({ runId: "r2", status: "queued", pass: null });
    // failed run is terminal → scored (fails, empty output ≠ expected) + surfaces error
    expect(rows[3]).toMatchObject({ runId: "r3", status: "failed", pass: false, error: "boom" });
  });

  it("marks a run id with no loaded run as missing + pending", () => {
    const rows = buildEvalRows(["ghost"], [{ a: 1 }], new Map());
    expect(rows[0]).toMatchObject({ runId: "ghost", status: "missing", pass: null });
  });

  it("defaults a row's expected to {} (vacuous pass) when undefined", () => {
    const rows = buildEvalRows(["r0"], [undefined], runsById);
    expect(rows[0]!.pass).toBe(true);
  });
});

describe("summarizeEval", () => {
  it("counts pass / fail / pending and computes passRate over scored rows", () => {
    const summary = summarizeEval([
      { pass: true },
      { pass: true },
      { pass: false },
      { pass: null },
    ]);
    expect(summary).toEqual({ total: 4, passed: 2, failed: 1, pending: 1, passRate: 2 / 3 });
  });

  it("passRate is 0 when nothing is scored yet", () => {
    expect(summarizeEval([{ pass: null }, { pass: null }])).toEqual({
      total: 2,
      passed: 0,
      failed: 0,
      pending: 2,
      passRate: 0,
    });
  });

  it("handles an empty row set", () => {
    expect(summarizeEval([])).toEqual({ total: 0, passed: 0, failed: 0, pending: 0, passRate: 0 });
  });
});

describe("matchValue (HEL-790 declarative matchers)", () => {
  it("falls back to deep-equality for non-matcher specs (backward compat)", () => {
    expect(matchValue("billing", "billing")).toBe(true);
    expect(matchValue("sales", "billing")).toBe(false);
    expect(matchValue({ a: 1 }, { a: 1 })).toBe(true); // plain object → deep-equal, not a matcher
    expect(matchValue([1, 2], [1, 2])).toBe(true);
  });

  it("$contains matches substrings and array membership", () => {
    expect(matchValue("please issue a refund", { $contains: "refund" })).toBe(true);
    expect(matchValue("all good", { $contains: "refund" })).toBe(false);
    expect(matchValue(["a", "b"], { $contains: "b" })).toBe(true);
    expect(matchValue(42, { $contains: "x" })).toBe(false);
  });

  it("$regex matches a pattern; an invalid regex fails", () => {
    expect(matchValue("TICKET-123", { $regex: "^TICKET-\\d+$" })).toBe(true);
    expect(matchValue("nope", { $regex: "^TICKET-\\d+$" })).toBe(false);
    expect(matchValue("x", { $regex: "(" })).toBe(false);
  });

  it("numeric comparisons (all ops must pass)", () => {
    expect(matchValue(0.9, { $gte: 0.8 })).toBe(true);
    expect(matchValue(0.7, { $gte: 0.8 })).toBe(false);
    expect(matchValue(5, { $gt: 4, $lt: 10 })).toBe(true);
    expect(matchValue(5, { $gt: 4, $lt: 5 })).toBe(false);
    expect(matchValue("5", { $gte: 1 })).toBe(false); // non-number → fail
  });

  it("$exists / $oneOf / $ne / $eq", () => {
    expect(matchValue("x", { $exists: true })).toBe(true);
    expect(matchValue(undefined, { $exists: false })).toBe(true);
    expect(matchValue(null, { $exists: true })).toBe(false);
    expect(matchValue("billing", { $oneOf: ["billing", "sales"] })).toBe(true);
    expect(matchValue("other", { $oneOf: ["billing", "sales"] })).toBe(false);
    expect(matchValue("a", { $ne: "b" })).toBe(true);
    expect(matchValue("a", { $eq: "a" })).toBe(true);
  });

  it("an unknown $-operator fails so a typo surfaces", () => {
    expect(matchValue("refund", { $contain: "refund" })).toBe(false);
  });
});

describe("compareEvalOutput with matchers (HEL-790)", () => {
  it("mixes exact fields and matcher specs in one expected object", () => {
    const r = compareEvalOutput(
      { label: "billing", summary: "the customer wants a refund", score: 0.92 },
      { label: "billing", summary: { $contains: "refund" }, score: { $gte: 0.8 } },
    );
    expect(r.pass).toBe(true);
  });

  it("reports the matcher spec as `expected` on a mismatch", () => {
    const r = compareEvalOutput({ score: 0.5 }, { score: { $gte: 0.8 } });
    expect(r.pass).toBe(false);
    expect(r.mismatches).toEqual([{ key: "score", expected: { $gte: 0.8 }, actual: 0.5 }]);
  });
});
