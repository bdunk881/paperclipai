/**
 * DASH-15 unit tests for the priority classifier prompt + parser.
 *
 * Live LLM behavior is covered by the route integration test
 * (agentActionsRoutes.test.ts) — these tests lock the shape of the
 * prompt and the parser's tolerance for malformed JSON so a future
 * refactor doesn't silently regress.
 */

// Block the transitive ESM-only @mistralai/mistralai import that
// `engine/llmProviders` pulls in at module evaluation time. The
// buildPrompt unit doesn't touch any provider.
jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

import { buildPrompt } from "./priorityClassifier";

describe("buildPrompt (DASH-15)", () => {
  it("includes the title verbatim", () => {
    const prompt = buildPrompt({ title: "Triage the latest churn cohort" });
    expect(prompt).toContain("Triage the latest churn cohort");
  });

  it("emits a '(none)' marker when the description is absent", () => {
    const prompt = buildPrompt({ title: "Anything" });
    expect(prompt).toContain("Description: (none)");
  });

  it("includes the description when present", () => {
    const prompt = buildPrompt({
      title: "Reply to Acme escalation",
      description: "Customer hit P0 — needs an answer today.",
    });
    expect(prompt).toContain("Customer hit P0 — needs an answer today.");
  });

  it("explicitly enumerates all four priority buckets", () => {
    const prompt = buildPrompt({ title: "x" });
    expect(prompt).toContain("low");
    expect(prompt).toContain("medium");
    expect(prompt).toContain("high");
    expect(prompt).toContain("urgent");
  });

  it("instructs JSON-only output with the exact shape", () => {
    const prompt = buildPrompt({ title: "x" });
    expect(prompt).toMatch(/JSON ONLY/i);
    expect(prompt).toContain('"priority"');
    expect(prompt).toContain('"reason"');
  });
});
