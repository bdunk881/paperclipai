/**
 * Regression coverage for parseTeamAssemblyResponse.
 *
 * The mission generate-plan flow surfaced a 502 ("Plan parse failed")
 * when the LLM (Mistral, in the reported incident) ignored the
 * "Return JSON only" instruction and wrapped the JSON in prose +
 * markdown fences. The fence-strip regex only matched fences at the
 * very start/end of the string, so any leading "Sure, here's the
 * plan:" exploded JSON.parse.
 *
 * These tests lock in resilience to the three real-world shapes we've
 * observed: clean JSON, fenced-only, and prose-around-fenced.
 */

import {
  buildTeamAssemblyPrompt,
  DEFAULT_ROLE_LIBRARY,
  parseTeamAssemblyResponse,
  TEAM_ASSEMBLY_SCHEMA_VERSION,
} from "./teamAssembly";

function validPlanJson(): string {
  const sampleRecommendation = {
    roleKey: "ceo",
    title: "Chief Executive",
    roleType: "executive",
    department: "Leadership",
    headcount: 1,
    reportsToRoleKey: null,
    mandate: "Set direction",
    justification: "Needed to align team",
    kpis: ["revenue"],
    skills: ["leadership"],
    tools: ["slack"],
    modelTier: "power",
    budgetMonthlyUsd: null,
    provisioningInstructions: "Provision via standard onboarding",
  };
  return JSON.stringify({
    schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
    company: {
      name: "Test Co",
      goal: "Ship a product",
      targetCustomer: null,
      budget: null,
      timeHorizon: null,
    },
    summary: "Lean exec team",
    rationale: "Test fixture",
    orgChart: {
      executives: [sampleRecommendation],
      operators: [],
      reportingLines: [],
    },
    provisioningPlan: {
      teamName: "Test Team",
      deploymentMode: "continuous_agents",
      agents: [sampleRecommendation],
    },
    roadmap306090: {
      day30: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["ceo"] },
      day60: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["ceo"] },
      day90: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["ceo"] },
    },
  });
}

describe("parseTeamAssemblyResponse", () => {
  it("parses a clean JSON response (well-behaved model)", () => {
    const result = parseTeamAssemblyResponse(validPlanJson());
    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
    expect(result.provisioningPlan.agents).toHaveLength(1);
  });

  it("strips opening + closing ```json fences (existing behavior)", () => {
    const wrapped = "```json\n" + validPlanJson() + "\n```";
    const result = parseTeamAssemblyResponse(wrapped);
    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
  });

  it("extracts JSON from a fenced block with chatty preamble (the Mistral 502 regression)", () => {
    const mistralStyle =
      "Sure! Here is the staffing plan you requested:\n\n```json\n" +
      validPlanJson() +
      "\n```\n\nLet me know if you'd like any adjustments.";
    const result = parseTeamAssemblyResponse(mistralStyle);
    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
    expect(result.provisioningPlan.teamName).toBe("Test Team");
  });

  it("extracts JSON when the model wraps the object in prose without fences", () => {
    const prose =
      "Based on the goal, here is the plan: " +
      validPlanJson() +
      " — hope that helps!";
    const result = parseTeamAssemblyResponse(prose);
    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
  });

  it("throws a descriptive error when no JSON object is present", () => {
    expect(() => parseTeamAssemblyResponse("I cannot help with that request."))
      .toThrow(/extract JSON|Unexpected/);
  });

  it("throws when the extracted JSON is valid JSON but fails schema validation", () => {
    const badShape = JSON.stringify({ schemaVersion: "wrong-version" });
    expect(() => parseTeamAssemblyResponse(badShape)).toThrow();
  });

  it("HEL-455: recovers when the model omits roleType + headcount on org-chart entries", () => {
    // gemini-2.5-pro reliably drops roleType/headcount even when asked. The
    // normalizer infers roleType from which array a role sits in (and agents
    // from their matching roleKey) and defaults headcount to 1 — so a plan
    // that is otherwise complete validates instead of 422-ing.
    const baseFields = {
      department: "support",
      reportsToRoleKey: null,
      mandate: "Own inbound support",
      justification: "Core to the mission",
      kpis: ["first-response time"],
      skills: ["triage"],
      tools: ["zendesk"],
      modelTier: "standard",
      budgetMonthlyUsd: null,
      provisioningInstructions: "Day-one: connect the inbox",
    };
    // NOTE: no `roleType`, no `headcount` on either entry.
    const exec = { roleKey: "support-lead", title: "Support Lead", ...baseFields };
    const op = {
      roleKey: "support-agent",
      title: "Support Agent",
      ...baseFields,
      reportsToRoleKey: "support-lead",
    };
    const raw = JSON.stringify({
      schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
      company: { name: "Test Co", goal: "Run support", targetCustomer: null, budget: null, timeHorizon: null },
      summary: "Support team",
      rationale: "Test fixture",
      orgChart: {
        executives: [exec],
        operators: [op],
        reportingLines: [{ managerRoleKey: "support-lead", reportRoleKey: "support-agent" }],
      },
      provisioningPlan: {
        teamName: "Support",
        deploymentMode: "continuous_agents",
        agents: [exec, op],
      },
      roadmap306090: {
        day30: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["support-lead"] },
        day60: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["support-lead"] },
        day90: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["support-lead"] },
      },
    });

    const result = parseTeamAssemblyResponse(raw);
    expect(result.orgChart.executives[0].roleType).toBe("executive");
    expect(result.orgChart.executives[0].headcount).toBe(1);
    expect(result.orgChart.operators[0].roleType).toBe("operator");
    expect(result.orgChart.operators[0].headcount).toBe(1);
    // Agent roleType is inferred from the matching org-chart roleKey.
    const leadAgent = result.provisioningPlan.agents.find((a) => a.roleKey === "support-lead");
    expect(leadAgent?.roleType).toBe("executive");
  });
});

describe("buildTeamAssemblyPrompt", () => {
  const baseInput = {
    companyName: "Northstar Ops",
    normalizedGoalDocument: {
      sourceType: "free_text" as const,
      goal: "Launch a field-service automation offer for HVAC contractors.",
      targetCustomer: "independent HVAC contractors with 10-50 technicians",
      successMetrics: ["book 40 qualified demos in 90 days"],
      constraints: ["Industry: HVAC field services"],
      budget: "$80k over 3 months",
      timeHorizon: null,
      importedContextSummary:
        "Industry: HVAC field services\nBudget / runway: $80k over 3 months",
      planReadinessThreshold: 0.6,
    },
  };

  it("omits the role catalog when the request has no role library", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...baseInput,
      roleLibrary: [],
      connectedToolSlugs: [],
    });

    expect(prompt).toContain("HVAC field services");
    expect(prompt).toContain("Do not default to a generic startup template");
    expect(prompt).not.toContain("Reference library");
    expect(prompt).not.toContain("Own strategy, resource allocation");
  });

  it("does not inject a role library appendix (hire flow is LLM-only)", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...baseInput,
      roleLibrary: [DEFAULT_ROLE_LIBRARY[0]],
      connectedToolSlugs: ["slack"],
    });

    expect(prompt).not.toContain("Reference library");
    expect(prompt).toContain("Integrations already connected");
    expect(prompt).toContain("slack");
    expect(prompt).not.toContain("Own strategy, resource allocation");
  });

  it("includes targetCustomer, successMetrics, budget, and importedContextSummary in the prompt", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...baseInput,
      roleLibrary: [],
      connectedToolSlugs: [],
    });

    expect(prompt).toContain("independent HVAC contractors with 10-50 technicians");
    expect(prompt).toContain("book 40 qualified demos in 90 days");
    expect(prompt).toContain("$80k over 3 months");
    expect(prompt).toContain("Industry: HVAC field services");
  });
});
