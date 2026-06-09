/**
 * HEL-670: Filter step — unit tests.
 *
 * Keeps the array items that pass a per-item predicate (item fields + `item` in
 * scope), passes through when there's no predicate, is a safe no-op on a
 * non-array source, and drops (never throws on) an unsafe predicate.
 */

import { applyItemFilter } from "./filterStep";
import type { WorkflowStep } from "../types/workflow";

function makeStep(config: Record<string, unknown> = {}): WorkflowStep {
  return { id: "f", name: "f", kind: "filter", description: "", inputKeys: [], outputKeys: [], config };
}

describe("applyItemFilter (HEL-670)", () => {
  it("keeps the items whose per-item predicate is true", () => {
    const ctx = { leads: [{ score: 80 }, { score: 20 }, { score: 55 }] };
    const r = applyItemFilter(makeStep({ itemsKey: "leads", condition: "score >= 50" }), ctx);
    expect(r.kept).toEqual([{ score: 80 }, { score: 55 }]);
    expect(r.filteredIn).toBe(2);
    expect(r.filteredOut).toBe(1);
  });

  it("exposes the whole item as `item` and keeps context in scope", () => {
    const ctx = { min: 3, nums: [1, 2, 3, 4] };
    const r = applyItemFilter(makeStep({ itemsKey: "nums", condition: "item >= min" }), ctx);
    expect(r.kept).toEqual([3, 4]);
  });

  it("passes the array through unchanged when there is no predicate", () => {
    const r = applyItemFilter(makeStep({ itemsKey: "xs" }), { xs: [1, 2, 3] });
    expect(r.kept).toEqual([1, 2, 3]);
    expect(r.filteredOut).toBe(0);
  });

  it("is a safe no-op on a missing / non-array source", () => {
    expect(applyItemFilter(makeStep({ itemsKey: "nope", condition: "x == 1" }), {}).kept).toEqual([]);
    expect(
      applyItemFilter(makeStep({ itemsKey: "s", condition: "x == 1" }), { s: "notarray" }).kept,
    ).toEqual([]);
  });

  it("drops an item (never throws) when the predicate is unsafe/malformed", () => {
    const ctx = { xs: [{ a: 1 }, { a: 2 }] };
    const r = applyItemFilter(makeStep({ itemsKey: "xs", condition: "evil()" }), ctx);
    expect(r.kept).toEqual([]);
    expect(r.filteredOut).toBe(2);
  });
});
