/**
 * Coverage for the Wave 6 starter Job Description body builder.
 *
 * The Hire flow's confirm step seeds a workspace_instructions row per
 * provisioned agent from the StaffingRecommendation. This module-local
 * helper takes the agent's structured fields and emits the same
 * Mission / How they work / Hard rules section shape the dashboard's
 * SectionEditor parses.
 */

import { buildStarterJobDescriptionBody } from "./hiringPlanRoutes";

function happyAgent() {
  return {
    title: "Aaron Chen",
    mandate: "Keep our largest customers healthy and renewing.",
    justification: "Aaron has the context to spot churn signals fastest.",
    kpis: ["Renewal rate ≥ 95%", "Health-score regressions caught < 24h"],
    tools: ["HubSpot", "Slack"],
    budgetMonthlyUsd: 800,
  };
}

describe("buildStarterJobDescriptionBody", () => {
  it("includes all three H2 sections", () => {
    const body = buildStarterJobDescriptionBody(happyAgent());
    expect(body).toContain("## Mission");
    expect(body).toContain("## How they work");
    expect(body).toContain("## Hard rules");
  });

  it("Mission section uses the mandate verbatim", () => {
    const body = buildStarterJobDescriptionBody(happyAgent());
    expect(body).toContain("Keep our largest customers healthy and renewing.");
  });

  it("How-they-work section embeds justification + KPI bullets + tools", () => {
    const body = buildStarterJobDescriptionBody(happyAgent());
    expect(body).toContain("spot churn signals fastest");
    expect(body).toContain("- Renewal rate ≥ 95%");
    expect(body).toContain("- Health-score regressions caught < 24h");
    expect(body).toContain("HubSpot, Slack");
  });

  it("Hard rules section includes the budget rule when budget > 0", () => {
    const body = buildStarterJobDescriptionBody(happyAgent());
    expect(body).toContain("Stay within your monthly budget of $800");
  });

  it("omits the budget rule when budget is null or zero", () => {
    const body = buildStarterJobDescriptionBody({
      ...happyAgent(),
      budgetMonthlyUsd: null,
    });
    expect(body).not.toContain("Stay within your monthly budget");
  });

  it("omits the tools line when tools is empty", () => {
    const body = buildStarterJobDescriptionBody({
      ...happyAgent(),
      tools: [],
    });
    expect(body).not.toContain("You'll typically use:");
  });

  it("always includes the two default safety bullets in Hard rules", () => {
    const body = buildStarterJobDescriptionBody(happyAgent());
    expect(body).toContain("Escalate to your manager");
    expect(body).toContain("Never share credentials");
  });
});
