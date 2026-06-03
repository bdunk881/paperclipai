import {
  buildHiringPlanUserError,
  classifyHiringPlanRawMessage,
  formatUserFacingErrorLine,
} from "./userFacingError";

describe("classifyHiringPlanRawMessage", () => {
  it("maps provider quota / 429 copy to upstream_quota", () => {
    const raw =
      "Gemini API error: [429 Too Many Requests] Your prepayment credits are depleted. Please go to AI Studio";
    expect(classifyHiringPlanRawMessage(raw, "llm_call")).toBe("upstream_quota");
  });

  it("maps auth failures to upstream_auth", () => {
    expect(classifyHiringPlanRawMessage("401 Unauthorized: invalid API key", "llm_call")).toBe(
      "upstream_auth",
    );
  });

  it("maps timeouts to timeout", () => {
    expect(classifyHiringPlanRawMessage("Request timed out after 90s", "llm_call")).toBe("timeout");
  });

  it("always maps parse phase to plan_parse regardless of raw text", () => {
    const raw =
      "Could not extract JSON from model response (team-assembly): Unexpected non-whitespace character at position 2006";
    expect(classifyHiringPlanRawMessage(raw, "parse")).toBe("plan_parse");
  });
});

describe("buildHiringPlanUserError", () => {
  it("never echoes provider, model, or billing URLs in the user message", () => {
    const raw =
      "LLM call failed (gemini/gemini-2.5-pro): Gemini API error: [429] credits depleted https://ai.studio/projects";
    const body = buildHiringPlanUserError(raw, "llm_call");
    expect(body.error).not.toMatch(/gemini/i);
    expect(body.error).not.toMatch(/ai\.studio/i);
    expect(body.error).not.toMatch(/429/);
    expect(body.code).toBe("upstream_quota");
    expect(body.reference).toMatch(/^[A-F0-9]{8}$/);
  });

  it("formats a support reference line for the dashboard", () => {
    const body = buildHiringPlanUserError("parse blew up", "parse");
    expect(formatUserFacingErrorLine(body)).toContain("Reference:");
    expect(formatUserFacingErrorLine(body)).not.toContain("team-assembly");
  });
});
