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
});

// ---------------------------------------------------------------------------
// buildTeamAssemblyPrompt — library vocabulary stripping
// Regression guard: the role library reference in the prompt must NOT include
// mandate or hiringSignals text, which caused the LLM to copy pre-written
// mandates verbatim and produce template-looking hiring plans.
// ---------------------------------------------------------------------------
describe("buildTeamAssemblyPrompt — role library reference", () => {
  const BASE_REQUEST = {
    companyName: "Acme Corp",
    normalizedGoalDocument: {
      sourceType: "free_text" as const,
      goal: "Launch a B2B sales motion in EMEA.",
      targetCustomer: null,
      successMetrics: [],
      constraints: [],
      budget: null,
      timeHorizon: null,
      planReadinessThreshold: 0.6,
    },
    roleLibrary: [...DEFAULT_ROLE_LIBRARY],
  };

  it("includes roleKey, title, department, defaultSkills, defaultTools in the prompt", () => {
    const prompt = buildTeamAssemblyPrompt(BASE_REQUEST);
    expect(prompt).toContain('"roleKey"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"department"');
    expect(prompt).toContain('"defaultSkills"');
    expect(prompt).toContain('"defaultTools"');
  });

  it("does NOT include role mandate text in the library reference section", () => {
    const prompt = buildTeamAssemblyPrompt(BASE_REQUEST);
    // The CEO mandate is a sentinel — if it appears, the library was included verbatim.
    expect(prompt).not.toContain("Own strategy, resource allocation, and cross-functional prioritization.");
    // Check a few others to be sure
    expect(prompt).not.toContain("Own pipeline creation, conversion, and revenue expansion.");
    expect(prompt).not.toContain("Own product architecture, engineering throughput, and technical risk management.");
  });

  it("does NOT include hiringSignals in the library reference section", () => {
    const prompt = buildTeamAssemblyPrompt(BASE_REQUEST);
    expect(prompt).not.toContain("hiringSignals");
    expect(prompt).not.toContain("ambiguous business strategy");
  });

  it("includes the goal statement verbatim in the prompt", () => {
    const prompt = buildTeamAssemblyPrompt(BASE_REQUEST);
    expect(prompt).toContain("Launch a B2B sales motion in EMEA.");
  });

  it("includes targetCustomer in the prompt when provided", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...BASE_REQUEST,
      normalizedGoalDocument: {
        ...BASE_REQUEST.normalizedGoalDocument,
        targetCustomer: "EMEA enterprise procurement leads",
      },
    });
    expect(prompt).toContain("EMEA enterprise procurement leads");
  });

  it("includes successMetrics in the prompt when provided", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...BASE_REQUEST,
      normalizedGoalDocument: {
        ...BASE_REQUEST.normalizedGoalDocument,
        successMetrics: ["€2M ARR by end of year"],
      },
    });
    expect(prompt).toContain("€2M ARR by end of year");
  });

  it("includes budget in the prompt when provided", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...BASE_REQUEST,
      normalizedGoalDocument: {
        ...BASE_REQUEST.normalizedGoalDocument,
        budget: "€400k over 9 months",
      },
    });
    expect(prompt).toContain("€400k over 9 months");
  });

  it("includes importedContextSummary in the prompt when provided", () => {
    const prompt = buildTeamAssemblyPrompt({
      ...BASE_REQUEST,
      normalizedGoalDocument: {
        ...BASE_REQUEST.normalizedGoalDocument,
        importedContextSummary: "Industry: industrial automation",
      },
    });
    expect(prompt).toContain("Industry: industrial automation");
  });
});
