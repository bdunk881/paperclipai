import { describe, expect, it } from "vitest";
import type { Agent } from "../api/agentApi";
import type { Mission } from "../api/missionsApi";
import {
  filterAgentsForMission,
  parseViewMode,
  resolveMissionSelection,
} from "./orgStructureModel";

function agent(id: string, missionId?: string): Agent {
  return {
    id,
    userId: "u1",
    name: id,
    instructions: "",
    status: "running",
    budgetMonthlyUsd: 0,
    metadata: missionId ? { missionId } : {},
    createdAt: "",
    updatedAt: "",
  };
}

const mission: Mission = {
  id: "m1",
  statement: "Test mission",
  status: "active",
  metadata: {},
  createdAt: "",
  companyId: "c1",
  companyName: "Acme",
  latestHiringPlanId: null,
};

describe("orgStructureModel", () => {
  it("parseViewMode defaults to map", () => {
    expect(parseViewMode(null)).toBe("map");
    expect(parseViewMode("list")).toBe("list");
  });

  it("resolveMissionSelection treats missing param as all workspace", () => {
    const result = resolveMissionSelection([mission], null);
    expect(result.scopeAllWorkspace).toBe(true);
    expect(result.selectedMissionId).toBeNull();
  });

  it("filterAgentsForMission uses missionId metadata when present", () => {
    const agents = [agent("a1", "m1"), agent("a2", "m2")];
    const filtered = filterAgentsForMission(agents, "m1", mission, new Map());
    expect(filtered.map((a) => a.id)).toEqual(["a1"]);
  });

  it("filterAgentsForMission falls back to company_id when no tags", () => {
    const agents = [agent("a1"), agent("a2")];
    const companyIds = new Map([
      ["a1", "c1"],
      ["a2", "c2"],
    ]);
    const filtered = filterAgentsForMission(agents, "m1", mission, companyIds);
    expect(filtered.map((a) => a.id)).toEqual(["a1"]);
  });
});
