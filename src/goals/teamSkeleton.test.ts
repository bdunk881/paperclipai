import {
  buildTeamSkeletonPrompt,
  parseTeamSkeletonResponse,
  teamSkeletonSchema,
} from "./teamSkeleton";
import { TEAM_ASSEMBLY_SCHEMA_VERSION, type TeamAssemblyRequest } from "./teamAssembly";

function makeSkeleton(roleCount: number): unknown {
  const roles: Array<{
    roleKey: string;
    title: string;
    roleType: "executive" | "operator";
    department: string;
    reportsToRoleKey: string | null;
  }> = [
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
    summary: "A team for the thing.",
    rationale: "Because the thing needs it.",
    teamName: "Thing Team",
    roles,
    reportingLines: roles
      .filter((r) => r.reportsToRoleKey)
      .map((r) => ({ managerRoleKey: r.reportsToRoleKey as string, reportRoleKey: r.roleKey })),
    roadmap306090: {
      day30: { objectives: ["o1"], deliverables: ["d1"], ownerRoleKeys: ["lead"] },
      day60: { objectives: ["o2"], deliverables: ["d2"], ownerRoleKeys: ["lead"] },
      day90: { objectives: ["o3"], deliverables: ["d3"], ownerRoleKeys: ["lead"] },
    },
  };
}

const baseRequest: TeamAssemblyRequest = {
  companyName: "Acme",
  normalizedGoalDocument: {
    sourceType: "free_text",
    goal: "Build an inbound support org with eight agents and a two-level hierarchy.",
    targetCustomer: null,
    successMetrics: ["faster first response"],
    constraints: ["escalate billing to a human"],
    budget: null,
    timeHorizon: null,
    planReadinessThreshold: 0.5,
  },
  roleLibrary: [],
  connectedToolSlugs: [],
};

describe("teamSkeleton (HEL-550 / chunked generation PR2)", () => {
  describe("parseTeamSkeletonResponse", () => {
    it("parses + validates a 12-role skeleton", () => {
      const result = parseTeamSkeletonResponse(JSON.stringify(makeSkeleton(12)));
      expect(result.roles).toHaveLength(12);
      expect(result.roles[0].roleType).toBe("executive");
      expect(result.teamName).toBe("Thing Team");
    });

    it("recovers a skeleton when the model appends a trailing note (shared extractor)", () => {
      const text = JSON.stringify(makeSkeleton(3)) + "\n\nLet me know if you want changes!";
      const result = parseTeamSkeletonResponse(text);
      expect(result.roles).toHaveLength(3);
    });

    it("strips heavy per-agent fields if the model leaks them (schema ignores extras)", () => {
      const raw = makeSkeleton(2) as { roles: Array<Record<string, unknown>> };
      raw.roles[0].mandate = "should not be here";
      raw.roles[0].kpis = ["x"];
      const result = parseTeamSkeletonResponse(JSON.stringify(raw));
      expect(result.roles[0]).not.toHaveProperty("mandate");
      expect(result.roles[0]).not.toHaveProperty("kpis");
    });

    it("rejects an empty roles array", () => {
      const empty = makeSkeleton(1) as { roles: unknown[] };
      empty.roles = [];
      expect(() => parseTeamSkeletonResponse(JSON.stringify(empty))).toThrow(
        /team-skeleton/,
      );
    });
  });

  describe("teamSkeletonSchema", () => {
    it("does not require heavy per-agent fields", () => {
      // A role with only the skeleton fields validates.
      const parsed = teamSkeletonSchema.safeParse(makeSkeleton(2));
      expect(parsed.success).toBe(true);
    });
  });

  describe("buildTeamSkeletonPrompt", () => {
    const prompt = buildTeamSkeletonPrompt(baseRequest);

    it("pins the schema version and embeds the goal", () => {
      expect(prompt).toContain(TEAM_ASSEMBLY_SCHEMA_VERSION);
      expect(prompt).toContain("two-level hierarchy");
    });

    it("explicitly defers the heavy per-agent fields to a later step", () => {
      expect(prompt).toContain("STRUCTURE ONLY");
      expect(prompt).toMatch(/Do NOT write mandates/i);
    });
  });
});
