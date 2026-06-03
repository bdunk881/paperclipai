import { describe, expect, it } from "vitest";
import {
  ApiUserError,
  classifyLegacyHiringPlanMessage,
  errorFromApiPayload,
  formatUserFacingError,
} from "./userFacingError";

describe("errorFromApiPayload", () => {
  it("uses server-sanitized copy when code is present", () => {
    const err = errorFromApiPayload(
      {
        error: "We couldn't generate a plan — the model returned an unexpected response. Retrying usually fixes it.",
        code: "plan_parse",
        reference: "A1B2C3D4",
      },
      "fallback",
    );
    expect(err).toBeInstanceOf(ApiUserError);
    expect(err.message).not.toMatch(/gemini/i);
    expect(err.reference).toBe("A1B2C3D4");
  });

  it("classifies legacy raw LLM strings without a code", () => {
    const err = errorFromApiPayload(
      {
        error:
          "LLM call failed (gemini/gemini-2.5-pro): Gemini API error: [429] credits depleted",
      },
      "fallback",
    );
    expect(err.message).toMatch(/over quota/i);
    expect(err.message).not.toMatch(/gemini/i);
  });
});

describe("formatUserFacingError", () => {
  it("appends a support reference when present", () => {
    const line = formatUserFacingError(
      new ApiUserError("Safe message", { reference: "DEADBEEF" }),
    );
    expect(line).toBe("Safe message (Reference: DEADBEEF)");
  });

  it("maps legacy parse errors on plain Error instances", () => {
    const line = formatUserFacingError(
      new Error("Plan parse failed (gemini/gemini-2.5-pro): Could not extract JSON"),
    );
    expect(line).toMatch(/unexpected response/i);
    expect(line).not.toMatch(/position/i);
  });
});

describe("classifyLegacyHiringPlanMessage", () => {
  it("detects plan parse failures", () => {
    expect(
      classifyLegacyHiringPlanMessage(
        "Plan parse failed (openai/gpt-4): Could not extract JSON (team-assembly)",
      ),
    ).toBe("plan_parse");
  });
});
