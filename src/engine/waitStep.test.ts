/**
 * HEL-672: Wait step — pure duration-resolution unit tests.
 */

import { resolveWaitMs, WAIT_MAX_MS } from "./waitStep";
import type { WorkflowStep } from "../types/workflow";

function makeStep(config: Record<string, unknown>): WorkflowStep {
  return { id: "w", name: "w", kind: "wait", description: "", inputKeys: [], outputKeys: [], config };
}

describe("resolveWaitMs (HEL-672)", () => {
  it("duration mode: amount + unit, or an explicit durationMs", () => {
    expect(resolveWaitMs(makeStep({ mode: "duration", amount: 5, unit: "minutes" }), 0)).toBe(
      5 * 60_000,
    );
    expect(resolveWaitMs(makeStep({ amount: 2, unit: "hours" }), 0)).toBe(2 * 3_600_000); // default mode
    expect(resolveWaitMs(makeStep({ durationMs: 1500 }), 0)).toBe(1500);
  });

  it("until mode: a future timestamp yields the remaining ms", () => {
    const now = 1_000_000;
    expect(
      resolveWaitMs(makeStep({ mode: "until", until: new Date(now + 60_000).toISOString() }), now),
    ).toBe(60_000);
    expect(resolveWaitMs(makeStep({ mode: "until", until: now + 5000 }), now)).toBe(5000);
  });

  it("a past until-time yields 0 (no wait)", () => {
    expect(resolveWaitMs(makeStep({ mode: "until", until: 500 }), 1000)).toBe(0);
  });

  it("invalid / missing config yields 0", () => {
    expect(resolveWaitMs(makeStep({}), 0)).toBe(0);
    expect(resolveWaitMs(makeStep({ mode: "until", until: "not-a-date" }), 0)).toBe(0);
    expect(resolveWaitMs(makeStep({ amount: -5, unit: "seconds" }), 0)).toBe(0);
  });

  it("caps at WAIT_MAX_MS", () => {
    expect(resolveWaitMs(makeStep({ amount: 9999, unit: "days" }), 0)).toBe(WAIT_MAX_MS);
  });
});
