import { describe, it, expect } from "vitest";
import { STEP_KIND_COPY, TRIGGER_PICKER_KINDS } from "../../pages/workflowStepSetup";

describe("TRIGGER_PICKER_KINDS (HEL-688)", () => {
  it("lists only trigger kinds, each with friendly copy the picker renders", () => {
    expect(TRIGGER_PICKER_KINDS.length).toBeGreaterThan(0);
    for (const kind of TRIGGER_PICKER_KINDS) {
      expect(kind.endsWith("trigger")).toBe(true);
      expect(STEP_KIND_COPY[kind]?.displayLabel).toBeTruthy();
      expect(STEP_KIND_COPY[kind]?.subtitle).toBeTruthy();
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(TRIGGER_PICKER_KINDS).size).toBe(TRIGGER_PICKER_KINDS.length);
  });
});
