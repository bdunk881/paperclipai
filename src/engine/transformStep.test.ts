/**
 * HEL-671: Set-Fields transform — unit tests.
 *
 * Covers value resolution (literal / {{template}} / safe expression / copy),
 * precedence, the safe-fallback-to-null on a bad/unsafe expression, config
 * parsing (incl. the legacy-identity fallback signal), and the value-returning
 * safeEvalExpression it relies on.
 */

import {
  parseTransformAssignments,
  applyFieldAssignments,
  resolveAssignment,
  type FieldAssignment,
} from "./transformStep";
import { safeEvalExpression } from "./safeConditionEval";

const ctx = { firstName: "Ada", lastName: "Lovelace", price: 10, qty: 3, tier: "gold" };

describe("transformStep (HEL-671)", () => {
  describe("resolveAssignment", () => {
    it("sets a literal value (falsy literals preserved)", () => {
      expect(resolveAssignment({ name: "x", value: 42 }, ctx)).toBe(42);
      expect(resolveAssignment({ name: "x", value: false }, ctx)).toBe(false);
      expect(resolveAssignment({ name: "x", value: 0 }, ctx)).toBe(0);
      expect(resolveAssignment({ name: "x" }, ctx)).toBeNull();
    });

    it("interpolates a {{template}} (missing keys keep the placeholder)", () => {
      expect(resolveAssignment({ name: "full", template: "{{firstName}} {{lastName}}" }, ctx)).toBe(
        "Ada Lovelace",
      );
      expect(resolveAssignment({ name: "x", template: "{{missing}}!" }, ctx)).toBe("{{missing}}!");
    });

    it("computes a safe expression with a typed result", () => {
      expect(resolveAssignment({ name: "total", expression: "price * qty" }, ctx)).toBe(30);
      expect(resolveAssignment({ name: "vip", expression: "tier == 'gold'" }, ctx)).toBe(true);
      expect(resolveAssignment({ name: "label", expression: "qty > 2 ? 'bulk' : 'single'" }, ctx)).toBe(
        "bulk",
      );
    });

    it("copies/renames via `from`", () => {
      expect(resolveAssignment({ name: "given", from: "firstName" }, ctx)).toBe("Ada");
      expect(resolveAssignment({ name: "given", from: "nope" }, ctx)).toBeNull();
    });

    it("returns null for a malformed/unsafe expression instead of throwing", () => {
      expect(resolveAssignment({ name: "x", expression: "evil()" }, ctx)).toBeNull();
      expect(resolveAssignment({ name: "x", expression: "obj.prop" }, ctx)).toBeNull();
    });

    it("honors precedence expression > template > from > value", () => {
      const a: FieldAssignment = {
        name: "x",
        expression: "1 + 1",
        template: "T",
        from: "firstName",
        value: 99,
      };
      expect(resolveAssignment(a, ctx)).toBe(2);
    });
  });

  describe("applyFieldAssignments", () => {
    it("applies a full list into one merged record", () => {
      const out = applyFieldAssignments(
        [
          { name: "full", template: "{{firstName}} {{lastName}}" },
          { name: "total", expression: "price * qty" },
          { name: "given", from: "firstName" },
          { name: "flag", value: true },
        ],
        ctx,
      );
      expect(out).toEqual({ full: "Ada Lovelace", total: 30, given: "Ada", flag: true });
    });
  });

  describe("parseTransformAssignments", () => {
    it("returns null when there is no usable list (legacy identity fallback)", () => {
      expect(parseTransformAssignments(undefined)).toBeNull();
      expect(parseTransformAssignments({})).toBeNull();
      expect(parseTransformAssignments({ assignments: "nope" })).toBeNull();
      expect(parseTransformAssignments({ assignments: [] })).toBeNull();
    });

    it("parses valid entries and skips nameless / garbage entries", () => {
      const parsed = parseTransformAssignments({
        assignments: [
          { name: "a", value: 1 },
          { name: "", value: 2 },
          { template: "x" },
          "garbage",
          { name: "b", expression: "a + 1" },
        ],
      });
      expect(parsed).toEqual([
        { name: "a", value: 1 },
        { name: "b", expression: "a + 1" },
      ]);
    });
  });

  describe("safeEvalExpression", () => {
    it("returns typed values, arrays, and identifier lookups", () => {
      expect(safeEvalExpression("2 + 3 * 4", {})).toBe(14);
      expect(safeEvalExpression("[1, 2, 3]", {})).toEqual([1, 2, 3]);
      expect(safeEvalExpression("greeting", { greeting: "hi" })).toBe("hi");
    });

    it("rejects calls and member access at the AST level", () => {
      expect(() => safeEvalExpression("alert(1)", {})).toThrow();
      expect(() => safeEvalExpression("obj.prop", { obj: {} })).toThrow();
    });
  });
});
