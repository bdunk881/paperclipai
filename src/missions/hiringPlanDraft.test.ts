import {
  attachDefaultSelection,
  filterDraftByIncludedRoleKeys,
  validateIncludedRoleKeys,
} from "./hiringPlanDraft";
import { TEAM_ASSEMBLY_SCHEMA_VERSION } from "../goals/teamAssembly";

function sampleDraft() {
  const agent = {
    roleKey: "lead",
    title: "Lead",
    roleType: "executive" as const,
    department: "ops",
    headcount: 1,
    reportsToRoleKey: null,
    mandate: "Lead the team",
    justification: "Needed",
    kpis: ["kpi"],
    skills: ["skill"],
    tools: ["slack"],
    modelTier: "power" as const,
    budgetMonthlyUsd: null,
    provisioningInstructions: "Start",
  };
  const operator = {
    ...agent,
    roleKey: "worker",
    title: "Worker",
    roleType: "operator" as const,
    reportsToRoleKey: "lead",
  };
  return attachDefaultSelection({
    schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
    company: {
      name: "Co",
      goal: "g",
      targetCustomer: null,
      budget: null,
      timeHorizon: null,
    },
    summary: "s",
    rationale: "r",
    orgChart: {
      executives: [agent],
      operators: [operator],
      reportingLines: [{ managerRoleKey: "lead", reportRoleKey: "worker" }],
    },
    provisioningPlan: {
      teamName: "Team",
      deploymentMode: "continuous_agents",
      agents: [agent, operator],
    },
    roadmap306090: {
      day30: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["lead"] },
      day60: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["lead"] },
      day90: { objectives: ["a"], deliverables: ["a"], ownerRoleKeys: ["lead"] },
    },
  });
}

describe("hiringPlanDraft", () => {
  it("filters agents and reporting lines by selection", () => {
    const draft = sampleDraft();
    const filtered = filterDraftByIncludedRoleKeys(draft, ["worker"]);
    expect(filtered.provisioningPlan.agents).toHaveLength(1);
    expect(filtered.provisioningPlan.agents[0]?.roleKey).toBe("worker");
    expect(filtered.orgChart.reportingLines).toHaveLength(0);
    expect(filtered.provisioningPlan.agents[0]?.reportsToRoleKey).toBeNull();
  });

  it("rejects empty selection", () => {
    const draft = sampleDraft();
    expect(validateIncludedRoleKeys(draft, [])).toMatch(/at least one/i);
  });
});
