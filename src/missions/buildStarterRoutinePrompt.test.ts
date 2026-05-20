/**
 * Coverage for the HEL-154 starter routine prompt builder.
 *
 * The hiring-plan confirm step seeds a single prompt-backed routine per
 * provisioned agent — weekday-morning UTC check-in built on the HEL-174
 * `executeAgentPrompt()` primitive. This helper turns the agent's
 * structured mandate into the NL prompt body that the routine carries.
 */

import { buildStarterRoutinePrompt } from "./hiringPlanRoutes";

describe("buildStarterRoutinePrompt", () => {
  it("opens with the agent's identity line", () => {
    const out = buildStarterRoutinePrompt({
      title: "Aaron Chen",
      mandate: "Keep our largest customers healthy and renewing.",
    });
    expect(out.startsWith("You are Aaron Chen.")).toBe(true);
  });

  it("includes the agent's mandate verbatim under a **Mandate** header", () => {
    const out = buildStarterRoutinePrompt({
      title: "Aaron Chen",
      mandate: "Keep our largest customers healthy and renewing.",
    });
    expect(out).toContain("**Mandate**");
    expect(out).toContain("Keep our largest customers healthy and renewing.");
  });

  it("instructs the agent to produce a short status report", () => {
    const out = buildStarterRoutinePrompt({
      title: "Marketing Lead",
      mandate: "Drive top-of-funnel growth.",
    });
    expect(out).toMatch(/short status report/i);
    expect(out).toMatch(/What moved/);
    expect(out).toMatch(/What's stuck/);
    expect(out).toMatch(/actions you'll take next/);
  });

  it("tells the agent to file an assignment when blocked rather than stalling", () => {
    const out = buildStarterRoutinePrompt({
      title: "Engineer",
      mandate: "Ship the platform.",
    });
    expect(out).toMatch(/file an assignment/i);
  });

  it("trims surrounding whitespace from the mandate", () => {
    const out = buildStarterRoutinePrompt({
      title: "Aaron Chen",
      mandate: "   Keep our largest customers healthy.\n   ",
    });
    // The mandate line shouldn't leak the leading spaces / trailing newline
    // — find the line itself and assert it equals the trimmed mandate.
    const mandateLine = out
      .split("\n")
      .find((line) => line.includes("Keep our largest customers healthy."));
    expect(mandateLine).toBe("Keep our largest customers healthy.");
  });
});
