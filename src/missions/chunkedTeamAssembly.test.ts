jest.mock("../engine/llmProviders", () => ({ getProvider: jest.fn() }));

import { getProvider } from "../engine/llmProviders";
import { generateTeamPlanChunked, chunkedResponseFormat } from "./chunkedTeamAssembly";
import { TEAM_ASSEMBLY_SCHEMA_VERSION, type TeamAssemblyRequest } from "../goals/teamAssembly";
import { teamSkeletonSchema } from "../goals/teamSkeleton";
import { roleDetailBatchSchema } from "../goals/roleDetail";

const mockedGetProvider = getProvider as jest.MockedFunction<typeof getProvider>;

function detail(): Record<string, unknown> {
  return {
    mandate: "Own a slice",
    justification: "Essential",
    kpis: ["k1"],
    skills: ["s1"],
    tools: ["slack"],
    modelTier: "standard",
    budgetMonthlyUsd: null,
    provisioningInstructions: "Day one: X",
  };
}

const SKELETON = {
  schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
  company: { name: "Acme", goal: "g", targetCustomer: null, budget: null, timeHorizon: null },
  summary: "summary",
  rationale: "rationale",
  teamName: "Team",
  roles: [
    { roleKey: "lead", title: "Lead", roleType: "executive", department: "exec", reportsToRoleKey: null },
    { roleKey: "op-1", title: "Op1", roleType: "operator", department: "ops", reportsToRoleKey: "lead" },
    { roleKey: "op-2", title: "Op2", roleType: "operator", department: "ops", reportsToRoleKey: "lead" },
  ],
  reportingLines: [
    { managerRoleKey: "lead", reportRoleKey: "op-1" },
    { managerRoleKey: "lead", reportRoleKey: "op-2" },
  ],
  roadmap306090: {
    day30: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
    day60: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
    day90: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
  },
};

const FILL = { lead: detail(), "op-1": detail(), "op-2": detail() };

const request: TeamAssemblyRequest = {
  companyName: "Acme",
  normalizedGoalDocument: {
    sourceType: "free_text",
    goal: "Build a small support team.",
    targetCustomer: null,
    successMetrics: ["x"],
    constraints: [],
    budget: null,
    timeHorizon: null,
    planReadinessThreshold: 0.5,
  },
  roleLibrary: [],
  connectedToolSlugs: [],
};

const llm = { provider: "gemini" as const, model: "gemini-2.5-pro", apiKey: "test-key" };

beforeEach(() => {
  mockedGetProvider.mockReset();
});

describe("generateTeamPlanChunked (HEL-553 / chunked generation PR5)", () => {
  it("runs skeleton -> fill -> assemble and aggregates usage", async () => {
    const skeletonFn = jest.fn().mockResolvedValue({
      text: JSON.stringify(SKELETON),
      usage: { promptTokens: 100, completionTokens: 200 },
    });
    const fillFn = jest.fn().mockResolvedValue({
      text: JSON.stringify(FILL),
      usage: { promptTokens: 50, completionTokens: 150 },
    });
    // 1st getProvider() = skeleton provider, 2nd = fill provider (reused).
    mockedGetProvider.mockReturnValueOnce(skeletonFn).mockReturnValue(fillFn);

    const { result, usage } = await generateTeamPlanChunked(request, llm);

    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
    expect(result.provisioningPlan.agents.map((a) => a.roleKey).sort()).toEqual([
      "lead",
      "op-1",
      "op-2",
    ]);
    expect(result.orgChart.executives).toHaveLength(1);
    expect(result.orgChart.operators).toHaveLength(2);
    // 3 roles fit in one fill batch on gemini.
    expect(skeletonFn).toHaveBeenCalledTimes(1);
    expect(fillFn).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({ promptTokens: 150, completionTokens: 350, calls: 2 });
  });

  it("retries a failed fill batch once before succeeding", async () => {
    const skeletonFn = jest.fn().mockResolvedValue({
      text: JSON.stringify(SKELETON),
      usage: { promptTokens: 10, completionTokens: 20 },
    });
    const fillFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("transient gemini blip"))
      .mockResolvedValue({ text: JSON.stringify(FILL), usage: { promptTokens: 5, completionTokens: 5 } });
    mockedGetProvider.mockReturnValueOnce(skeletonFn).mockReturnValue(fillFn);

    const { result, usage } = await generateTeamPlanChunked(request, llm);

    expect(result.provisioningPlan.agents).toHaveLength(3);
    expect(fillFn).toHaveBeenCalledTimes(2); // failed once, retried once
    // skeleton + 1 successful fill counted (the rejected attempt added no usage)
    expect(usage.calls).toBe(2);
  });

  it("rejects when a fill batch fails twice", async () => {
    const skeletonFn = jest.fn().mockResolvedValue({
      text: JSON.stringify(SKELETON),
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const fillFn = jest.fn().mockRejectedValue(new Error("persistent failure"));
    mockedGetProvider.mockReturnValueOnce(skeletonFn).mockReturnValue(fillFn);

    await expect(generateTeamPlanChunked(request, llm)).rejects.toThrow(/persistent failure/);
    expect(fillFn).toHaveBeenCalledTimes(2);
  });
});

describe("chunkedResponseFormat (HEL-625)", () => {
  it("gives Anthropic a REAL json_schema (not the permissive {} that yielded empty output)", () => {
    const rf = chunkedResponseFormat("anthropic", teamSkeletonSchema);
    expect(rf.type).toBe("json_schema");
    if (rf.type !== "json_schema") throw new Error("unreachable");
    expect(rf.schema.type).toBe("object");
    const props = rf.schema.properties as Record<string, unknown>;
    expect(props).toBeDefined();
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["company", "summary", "roles", "reportingLines", "roadmap306090"]),
    );
    // $schema meta-key stripped (Anthropic tool input_schema wants the bare shape).
    expect(rf.schema.$schema).toBeUndefined();
  });

  it("converts the preprocess-wrapped fill record to an object schema", () => {
    const rf = chunkedResponseFormat("anthropic", roleDetailBatchSchema);
    expect(rf.type).toBe("json_schema");
    if (rf.type !== "json_schema") throw new Error("unreachable");
    expect(rf.schema.type).toBe("object");
    expect(rf.schema.additionalProperties).toBeDefined();
  });

  it("leaves gemini + openai on json_object (they follow the prompt; OpenAI json_schema is strict)", () => {
    expect(chunkedResponseFormat("gemini", teamSkeletonSchema)).toEqual({ type: "json_object" });
    expect(chunkedResponseFormat("openai", roleDetailBatchSchema)).toEqual({ type: "json_object" });
  });
});
