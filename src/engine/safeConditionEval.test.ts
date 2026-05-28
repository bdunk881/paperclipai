/**
 * HEL-254 / SEC-03 — tests for the safe condition evaluator that
 * replaces the old `new Function(...)` eval sink.
 */
import { normalizeJsCondition, safeEvalCondition } from "./safeConditionEval";

describe("safeEvalCondition — valid expressions", () => {
  it("evaluates comparison expressions", () => {
    expect(safeEvalCondition("a > 10", { a: 15 })).toBe(true);
    expect(safeEvalCondition("a > 10", { a: 5 })).toBe(false);
  });

  it("evaluates string equality with double-equals (expr-eval has no ===)", () => {
    expect(safeEvalCondition('status == "approved"', { status: "approved" })).toBe(true);
    expect(safeEvalCondition('status == "approved"', { status: "rejected" })).toBe(false);
  });

  it("evaluates logical AND with mixed comparisons", () => {
    expect(
      safeEvalCondition("count >= 5 and flag == true", { count: 5, flag: true }),
    ).toBe(true);
    expect(
      safeEvalCondition("count >= 5 and flag == true", { count: 5, flag: false }),
    ).toBe(false);
  });

  it("evaluates logical OR", () => {
    expect(safeEvalCondition("a == 1 or b == 2", { a: 0, b: 2 })).toBe(true);
    expect(safeEvalCondition("a == 1 or b == 2", { a: 0, b: 0 })).toBe(false);
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

  it("returns boolean (Boolean cast) for truthy/falsy non-boolean evaluations", () => {
    expect(safeEvalCondition("a", { a: 1 })).toBe(true);
    expect(safeEvalCondition("a", { a: 0 })).toBe(false);
    expect(safeEvalCondition('a', { a: "" })).toBe(false);
    expect(safeEvalCondition("a", { a: "anything" })).toBe(true);
  });
});

describe("safeEvalCondition — JS-syntax compatibility (operator normalization)", () => {
  it("accepts === and converts it to ==", () => {
    expect(safeEvalCondition('intent === "general"', { intent: "general" })).toBe(true);
    expect(safeEvalCondition('intent === "general"', { intent: "billing" })).toBe(false);
  });

  it("accepts !== and converts it to !=", () => {
    expect(safeEvalCondition('intent !== "general"', { intent: "billing" })).toBe(true);
  });

  it("accepts && as logical and (NOT as bitwise/string-concat)", () => {
    expect(
      safeEvalCondition("count >= 5 && flag === true", { count: 5, flag: true }),
    ).toBe(true);
    expect(
      safeEvalCondition("count >= 5 && flag === true", { count: 4, flag: true }),
    ).toBe(false);
  });

  it("accepts || as logical or (expr-eval native || is string concat — verify we override)", () => {
    expect(safeEvalCondition("a === 1 || b === 2", { a: 0, b: 2 })).toBe(true);
    expect(safeEvalCondition("a === 1 || b === 2", { a: 0, b: 0 })).toBe(false);
    expect(safeEvalCondition("a === 1 || b === 2", { a: 1, b: 0 })).toBe(true);
  });
});

describe("normalizeJsCondition — string-literal awareness", () => {
  it("rewrites JS operators outside string literals", () => {
    expect(normalizeJsCondition("a === b && c !== d")).toBe("a  ==  b  and  c  !=  d");
    expect(normalizeJsCondition("a || b")).toBe("a  or  b");
  });

  it("preserves operator-looking content INSIDE string literals", () => {
    expect(normalizeJsCondition('name === "Bob && Alice"')).toBe('name  ==  "Bob && Alice"');
    expect(normalizeJsCondition("msg === 'a || b'")).toBe("msg  ==  'a || b'");
  });

  it("honors backslash escapes in string literals", () => {
    expect(normalizeJsCondition('name === "He said \\"yes && no\\""'))
      .toBe('name  ==  "He said \\"yes && no\\""');
  });

  it("leaves expressions with no JS operators unchanged", () => {
    expect(normalizeJsCondition("a > 10 and b == 5")).toBe("a > 10 and b == 5");
    expect(normalizeJsCondition("intent in autoRespondCategories")).toBe(
      "intent in autoRespondCategories",
    );
  });
});

describe("safeEvalCondition — unsafe expressions (SEC-03 RCE guard)", () => {
  it("does NOT expose process.env — `process` is an unbound identifier and throws", () => {
    expect(() => safeEvalCondition("process.env.DATABASE_URL", {})).toThrow();
  });

  it("does NOT expose global", () => {
    expect(() => safeEvalCondition("global.process.exit", {})).toThrow();
  });

  it("does NOT expose require", () => {
    // expr-eval treats `require` as either an unbound identifier or a
    // function-call against an unknown function — both fail before any
    // module loads.
    expect(() => safeEvalCondition("require('fs')", {})).toThrow();
  });

  it("can't escalate via __proto__ / constructor lookups (member access blocked at parse time)", () => {
    // expr-eval's identifier lookup walks the JS prototype chain, so
    // `constructor` (= the Object function) and `__proto__` (= the
    // object prototype) ARE reachable as bare identifiers. That's
    // harmless: expr-eval has no `.` member-access outside math
    // function calls, so these references are dead-end — they can't be
    // operated on, called, or read further. The two chained-access
    // forms that COULD enable an escape parse-fail at the dot.
    expect(() => safeEvalCondition("__proto__.constructor", {})).toThrow();
    expect(() => safeEvalCondition("constructor.constructor", {})).toThrow();
  });

  it("throws on syntax garbage rather than evaluating", () => {
    expect(() => safeEvalCondition(")(invalid(", {})).toThrow();
    expect(() => safeEvalCondition("a > > 10", { a: 1 })).toThrow();
  });

  it("does NOT allow assignment to mutate scope", () => {
    // assignment operator is disabled in the parser config.
    expect(() => safeEvalCondition("a = 5", { a: 1 })).toThrow();
  });

  it("does NOT leak DATABASE_URL even via OR fallback (the SEC-03 acceptance case)", () => {
    // The classic payload: `process.env.DATABASE_URL || true`. `process`
    // is unbound → parser throws → no value leaks to a downstream sink.
    expect(() =>
      safeEvalCondition("process.env.DATABASE_URL or true", {}),
    ).toThrow();
  });
});
