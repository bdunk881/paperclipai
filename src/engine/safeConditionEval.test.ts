/**
 * HEL-254 / SEC-03 + HEL-259 / SEC-14 — tests for the safe condition
 * evaluator (jsep + custom AST walker), replaces the prior expr-eval
 * version that carried unfixed prototype-pollution and unrestricted-
 * function-call advisories.
 */
import { safeEvalCondition } from "./safeConditionEval";

describe("safeEvalCondition — valid expressions", () => {
  it("evaluates comparison expressions", () => {
    expect(safeEvalCondition("a > 10", { a: 15 })).toBe(true);
    expect(safeEvalCondition("a > 10", { a: 5 })).toBe(false);
  });

  it("accepts both === and == (jsep parses JS syntax natively)", () => {
    expect(safeEvalCondition('status === "approved"', { status: "approved" })).toBe(true);
    expect(safeEvalCondition('status == "approved"', { status: "approved" })).toBe(true);
    expect(safeEvalCondition('status !== "approved"', { status: "rejected" })).toBe(true);
    expect(safeEvalCondition('status != "approved"', { status: "rejected" })).toBe(true);
  });

  it("evaluates logical AND with &&", () => {
    expect(
      safeEvalCondition("count >= 5 && flag === true", { count: 5, flag: true }),
    ).toBe(true);
    expect(
      safeEvalCondition("count >= 5 && flag === true", { count: 5, flag: false }),
    ).toBe(false);
  });

  it("evaluates logical OR with ||", () => {
    expect(safeEvalCondition("a === 1 || b === 2", { a: 0, b: 2 })).toBe(true);
    expect(safeEvalCondition("a === 1 || b === 2", { a: 0, b: 0 })).toBe(false);
  });

  it("evaluates ternary", () => {
    expect(safeEvalCondition("a > 10 ? b : c", { a: 15, b: true, c: false })).toBe(true);
    expect(safeEvalCondition("a > 10 ? b : c", { a: 5, b: true, c: false })).toBe(false);
  });

  it("evaluates `in` array membership (replacement for legacy .includes() pattern)", () => {
    expect(
      safeEvalCondition("intent in autoRespondCategories", {
        intent: "billing_question",
        autoRespondCategories: ["billing_question", "feature_request"],
      }),
    ).toBe(true);
    expect(
      safeEvalCondition("intent in autoRespondCategories", {
        intent: "complaint",
        autoRespondCategories: ["billing_question", "feature_request"],
      }),
    ).toBe(false);
  });

  it("evaluates unary !", () => {
    expect(safeEvalCondition("!a", { a: false })).toBe(true);
    expect(safeEvalCondition("!a", { a: true })).toBe(false);
  });

  it("evaluates arithmetic operators", () => {
    expect(safeEvalCondition("a + 1 > 10", { a: 10 })).toBe(true);
    expect(safeEvalCondition("a * 2 === 20", { a: 10 })).toBe(true);
    expect(safeEvalCondition("a - b === 0", { a: 5, b: 5 })).toBe(true);
  });

  it("returns boolean (Boolean cast) for truthy/falsy non-boolean evaluations", () => {
    expect(safeEvalCondition("a", { a: 1 })).toBe(true);
    expect(safeEvalCondition("a", { a: 0 })).toBe(false);
    expect(safeEvalCondition('a', { a: "" })).toBe(false);
    expect(safeEvalCondition("a", { a: "anything" })).toBe(true);
  });
});

describe("safeEvalCondition — RCE guard (the SEC-03 boundary)", () => {
  it("rejects function calls — no way to invoke anything", () => {
    expect(() => safeEvalCondition("require('fs')", {})).toThrow(/function calls/i);
    expect(() => safeEvalCondition("fn(a)", { fn: () => 1, a: 1 })).toThrow(/function calls/i);
  });

  it("rejects member access — process.env etc unreachable", () => {
    expect(() => safeEvalCondition("a.b", { a: { b: 1 } })).toThrow(/member access/i);
    expect(() => safeEvalCondition("process.env.DATABASE_URL", {})).toThrow(/member access/i);
  });

  it("rejects assignment — no scope mutation", () => {
    // jsep itself parse-errors on `=`; we get a parse error rather than
    // the explicit "assignment not allowed" message, but the boundary
    // holds — the expression doesn't evaluate.
    expect(() => safeEvalCondition("a = 5", { a: 1 })).toThrow();
  });

  it("identifier lookup must be an own-property — prototype chain not walked", () => {
    // `constructor` exists on Object.prototype but our isOwnKey guard
    // rejects it. Same for __proto__.
    expect(() => safeEvalCondition("constructor", { a: 1 })).toThrow(/unbound identifier/i);
    expect(() => safeEvalCondition("__proto__", { a: 1 })).toThrow(/unbound identifier/i);
    expect(() => safeEvalCondition("toString", { a: 1 })).toThrow(/unbound identifier/i);
  });

  it("`in` operator only works on arrays, not objects (no prototype walks)", () => {
    expect(() =>
      safeEvalCondition("constructor in obj", { obj: { constructor: Object } }),
    ).toThrow();
  });

  it("throws on unbound identifiers without leaking values", () => {
    expect(() => safeEvalCondition("undef + 1", {})).toThrow(/unbound identifier/i);
    expect(() =>
      safeEvalCondition("process.env.DATABASE_URL || true", {}),
    ).toThrow();
  });

  it("throws on syntax garbage", () => {
    expect(() => safeEvalCondition(")(invalid(", {})).toThrow();
    expect(() => safeEvalCondition("a > > 10", { a: 1 })).toThrow();
  });
});

describe("safeEvalCondition — resource limits (DoS guards)", () => {
  it("rejects over-long expressions before parsing", () => {
    const huge = `${"a + ".repeat(1000)}a`;
    expect(() => safeEvalCondition(huge, { a: 1 })).toThrow(/too long/i);
  });

  it("rejects pathologically deep nesting without crashing the stack", () => {
    // Deeply parenthesized unary chain stays under the length cap but
    // exceeds the AST depth cap.
    const deep = `${"!".repeat(200)}a`;
    expect(() => safeEvalCondition(deep, { a: true })).toThrow(/too deep/i);
  });

  it("rejects non-string input defensively", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => safeEvalCondition(null, {})).toThrow(/must be a string/i);
  });
});

describe("safeEvalCondition — short-circuit semantics", () => {
  it("does not evaluate the dead branch of || when the left is truthy", () => {
    // `missing` is unbound; under eager evaluation it would throw. Proper
    // short-circuit must return the truthy left without touching it.
    expect(safeEvalCondition("hasItems || missing", { hasItems: true })).toBe(true);
  });

  it("does not evaluate the dead branch of && when the left is falsy", () => {
    expect(safeEvalCondition("hasItems && missing", { hasItems: false })).toBe(false);
  });

  it("still evaluates the live branch of && when the left is truthy", () => {
    expect(safeEvalCondition("hasItems && ready", { hasItems: true, ready: true })).toBe(true);
    expect(safeEvalCondition("hasItems && ready", { hasItems: true, ready: false })).toBe(false);
  });
});

describe("safeEvalCondition — SEC-03 acceptance payload", () => {
  it("process.env.DATABASE_URL || true never leaks DATABASE_URL (the exact spec payload)", () => {
    // process is unbound → MemberExpression rejection fires before any
    // env lookup. Even if it didn't, identifier `process` isn't in
    // scope so identifier lookup would also throw.
    expect(() =>
      safeEvalCondition("process.env.DATABASE_URL || true", {}),
    ).toThrow();
  });
});
