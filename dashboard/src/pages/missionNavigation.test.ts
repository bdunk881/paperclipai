import { describe, expect, it } from "vitest";
import { missionLinkTo, teamLinkForMission } from "../lib/missionNavigation";
import type { Mission } from "../api/missionsApi";

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    statement: "Test mission",
    status: "draft",
    metadata: {},
    createdAt: new Date().toISOString(),
    companyId: "22222222-2222-4222-8222-222222222222",
    companyName: "Acme",
    latestHiringPlanId: null,
    ...overrides,
  };
}

describe("missionLinkTo", () => {
  it("routes active missions with a team to the mission hub", () => {
    const link = missionLinkTo(
      mission({
        status: "active",
        latestHiringPlanId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(link).toBe("/missions/11111111-1111-4111-8111-111111111111");
  });

  it("routes draft missions with a plan to hiring plan review", () => {
    const link = missionLinkTo(
      mission({
        status: "review",
        latestHiringPlanId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(link).toBe(
      "/hire/plan/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333",
    );
  });

  it("routes missions without a plan to hire intake", () => {
    expect(missionLinkTo(mission())).toBe(
      "/hire?missionId=11111111-1111-4111-8111-111111111111",
    );
  });
});

describe("teamLinkForMission", () => {
  it("includes missionId query param", () => {
    expect(teamLinkForMission("abc")).toBe("/workspace/org-structure?missionId=abc");
  });
});
