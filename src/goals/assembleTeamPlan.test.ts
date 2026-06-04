import { assembleTeamPlan } from "./assembleTeamPlan";
import { TEAM_ASSEMBLY_SCHEMA_VERSION } from "./teamAssembly";
import type { TeamSkeleton } from "./teamSkeleton";
import type { RoleDetail } from "./roleDetail";

function makeSkeleton(roleCount: number): TeamSkeleton {
  const roles: TeamSkeleton["roles"] = [
    { roleKey: "lead", title: "Lead", roleType: "executive", department: "exec", reportsToRoleKey: null },
  ];
  for (let i = 1; i < roleCount; i += 1) {
    roles.push({
      roleKey: `op-${i}`,
      title: `Operator ${i}`,
      roleType: "operator",
      department: "ops",
      reportsToRoleKey: "lead",
    });
  }
  return {
    schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
    company: { name: "Acme", goal: "Do the thing", targetCustomer: null, budget: null, timeHorizon: null },
    summary: "Team summary.",
    rationale: "Team rationale.",
    teamName: "The Team",
    roles,
    reportingLines: roles
      .filter((r) => r.reportsToRoleKey)
      .map((r) => ({ managerRoleKey: r.reportsToRoleKey as string, reportRoleKey: r.roleKey })),
    roadmap306090: {
      day30: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
      day60: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
      day90: { objectives: ["o"], deliverables: ["d"], ownerRoleKeys: ["lead"] },
    },
  };
}

function detail(): RoleDetail {
  return {
    mandate: "Own a slice of the mission",
    justification: "Essential to the goal",
    kpis: ["k1", "k2"],
    skills: ["s1"],
    tools: ["slack"],
    modelTier: "standard",
    budgetMonthlyUsd: null,
    provisioningInstructions: "Start by doing X",
  };
}

function fillsFor(skeleton: TeamSkeleton): Record<string, RoleDetail> {
  const out: Record<string, RoleDetail> = {};
  for (const role of skeleton.roles) out[role.roleKey] = detail();
  return out;
}

describe("assembleTeamPlan (HEL-552 / chunked generation PR4)", () => {
  it("assembles a valid 15-agent plan that passes the canonical schema", () => {
    const skeleton = makeSkeleton(15);
    const result = assembleTeamPlan(skeleton, fillsFor(skeleton));

    expect(result.schemaVersion).toBe(TEAM_ASSEMBLY_SCHEMA_VERSION);
    expect(result.orgChart.executives).toHaveLength(1);
    expect(result.orgChart.operators).toHaveLength(14);
    expect(result.provisioningPlan.agents).toHaveLength(15);
    expect(result.provisioningPlan.deploymentMode).toBe("continuous_agents");
  });

  it("derives provisioningPlan.agents as the org-chart union (exec + operators)", () => {
    const skeleton = makeSkeleton(5);
    const result = assembleTeamPlan(skeleton, fillsFor(skeleton));
    const union = [...result.orgChart.executives, ...result.orgChart.operators].map((a) => a.roleKey);
    expect(result.provisioningPlan.agents.map((a) => a.roleKey)).toEqual(union);
  });

  it("merges skeleton identity with fill detail and defaults headcount to 1", () => {
    const skeleton = makeSkeleton(2);
    const result = assembleTeamPlan(skeleton, fillsFor(skeleton));
    const lead = result.provisioningPlan.agents.find((a) => a.roleKey === "lead");
    expect(lead).toMatchObject({
      roleKey: "lead",
      roleType: "executive",
      department: "exec",
      headcount: 1,
      mandate: "Own a slice of the mission",
    });
  });

  it("throws listing the roles with no fill", () => {
    const skeleton = makeSkeleton(4);
    const fills = fillsFor(skeleton);
    delete fills["op-3"];
    expect(() => assembleTeamPlan(skeleton, fills)).toThrow(
      /missing role details for: op-3/,
    );
  });

  it("throws on a dangling reportsToRoleKey", () => {
    const skeleton = makeSkeleton(2);
    skeleton.roles[1].reportsToRoleKey = "ghost";
    expect(() => assembleTeamPlan(skeleton, fillsFor(skeleton))).toThrow(
      /dangling roleKey references[\s\S]*ghost/,
    );
  });

  it("throws on a dangling roadmap ownerRoleKey", () => {
    const skeleton = makeSkeleton(2);
    skeleton.roadmap306090.day60.ownerRoleKeys = ["nobody"];
    expect(() => assembleTeamPlan(skeleton, fillsFor(skeleton))).toThrow(
      /dangling roleKey references[\s\S]*nobody/,
    );
  });
});
