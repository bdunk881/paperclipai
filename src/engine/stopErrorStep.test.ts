/**
 * HEL-674: Stop-And-Error step — unit tests.
 *
 * Resolves the author's failure message (with {{key}} interpolation against the
 * run context), supports a legacy `errorMessage` alias, falls back to a default
 * when blank, and surfaces an optional error type.
 */

import { resolveStopError, DEFAULT_STOP_MESSAGE } from "./stopErrorStep";
import type { WorkflowStep } from "../types/workflow";

function makeStep(config: Record<string, unknown> = {}): WorkflowStep {
  return {
    id: "s",
    name: "s",
    kind: "stop_error",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config,
  };
}

describe("resolveStopError (HEL-674)", () => {
  it("returns the configured message verbatim", () => {
    const r = resolveStopError(makeStep({ message: "Record not found" }), {});
    expect(r.message).toBe("Record not found");
    expect(r.errorType).toBeNull();
  });

  it("interpolates {{key}} placeholders from the run context", () => {
    const r = resolveStopError(makeStep({ message: "No lead for {{email}}" }), { email: "a@b.io" });
    expect(r.message).toBe("No lead for a@b.io");
  });

  it("keeps a placeholder literal when the context key is missing", () => {
    const r = resolveStopError(makeStep({ message: "Missing {{whoops}}" }), {});
    expect(r.message).toBe("Missing {{whoops}}");
  });

  it("accepts the legacy errorMessage alias", () => {
    const r = resolveStopError(makeStep({ errorMessage: "legacy reason" }), {});
    expect(r.message).toBe("legacy reason");
  });

  it("falls back to a default when the message is blank or missing", () => {
    expect(resolveStopError(makeStep({}), {}).message).toBe(DEFAULT_STOP_MESSAGE);
    expect(resolveStopError(makeStep({ message: "   " }), {}).message).toBe(DEFAULT_STOP_MESSAGE);
  });

  it("surfaces an optional error type", () => {
    const r = resolveStopError(makeStep({ message: "x", errorType: "ValidationError" }), {});
    expect(r.errorType).toBe("ValidationError");
  });
});
