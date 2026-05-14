/**
 * Composite retrieval ranker tests (HEL-89).
 *
 * Pure function — no DB, no HTTP. Validates each weight component shifts
 * the ranking the way the formula prescribes.
 */

import { buildOrgGraph, rankCandidates, type RankCandidate } from "./retrievalRanker";

const FROZEN_NOW = new Date("2026-05-14T12:00:00Z");

function makeCandidate(overrides: Partial<RankCandidate> = {}): RankCandidate {
  return {
    id: overrides.id ?? `id-${Math.random()}`,
    baseSimilarity: 0.8,
    layer: "knowledge",
    kind: "document",
    scope: "workspace",
    missionId: null,
    authorAgentId: null,
    createdAt: FROZEN_NOW, // age = 0
    ...overrides,
  };
}

describe("retrievalRanker — single-weight isolation (HEL-89)", () => {
  it("knowledge layer ranks above episode layer at equal base similarity", () => {
    const candidates = [
      makeCandidate({ id: "k", layer: "knowledge" }),
      makeCandidate({ id: "e", layer: "episode" }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW });
    expect(ranked[0].id).toBe("k");
    expect(ranked[1].id).toBe("e");
  });

  it("verified > document > connector_pull > synthesized via trust weight", () => {
    const candidates = [
      makeCandidate({ id: "v", kind: "verified" }),
      makeCandidate({ id: "d", kind: "document" }),
      makeCandidate({ id: "c", kind: "connector_pull" }),
      makeCandidate({ id: "s", kind: "synthesized" }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW });
    expect(ranked.map((r) => r.id)).toEqual(["v", "d", "c", "s"]);
  });

  it("workspace scope ranks above autoflow_curated scope", () => {
    const candidates = [
      makeCandidate({ id: "w", scope: "workspace" }),
      makeCandidate({ id: "a", scope: "autoflow_curated" }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW });
    expect(ranked[0].id).toBe("w");
  });

  it("current-mission items boost above other-mission items", () => {
    const mission = "m-current";
    const otherMission = "m-other";
    const candidates = [
      makeCandidate({ id: "current", missionId: mission }),
      makeCandidate({ id: "other", missionId: otherMission }),
      makeCandidate({ id: "none", missionId: null }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW, currentMissionId: mission });
    expect(ranked[0].id).toBe("current");
    expect(ranked[2].id).toBe("other"); // penalized
  });

  it("recency: newer items rank above older ones (30d half-life)", () => {
    const candidates = [
      makeCandidate({ id: "today", createdAt: FROZEN_NOW }),
      makeCandidate({
        id: "30d",
        createdAt: new Date(FROZEN_NOW.getTime() - 30 * 24 * 3600 * 1000),
      }),
      makeCandidate({
        id: "90d",
        createdAt: new Date(FROZEN_NOW.getTime() - 90 * 24 * 3600 * 1000),
      }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW });
    expect(ranked.map((r) => r.id)).toEqual(["today", "30d", "90d"]);
    // Approximate: 30-day item is ~e^-1 of "today"
    expect(ranked[1].finalScore / ranked[0].finalScore).toBeCloseTo(1 / Math.E, 1);
  });
});

describe("retrievalRanker — org-chart weighting (HEL-89)", () => {
  const me = "agent-me";
  const myBoss = "agent-boss";
  const peer = "agent-peer";
  const stranger = "agent-stranger";

  const orgGraph = buildOrgGraph([
    { managerAgentId: myBoss, agentId: me },
    { managerAgentId: myBoss, agentId: peer }, // peer shares my manager
    // stranger has no manager and no connection to me
  ]);

  function ctx(extra: Partial<Parameters<typeof rankCandidates>[1]> = {}) {
    return {
      now: FROZEN_NOW,
      requestingAgentId: me,
      orgManagersByAgent: orgGraph.managersByAgent,
      orgReportsByAgent: orgGraph.reportsByAgent,
      ...extra,
    };
  }

  it("manager's memories boost above peer's, peer above stranger", () => {
    const candidates = [
      makeCandidate({ id: "from-boss", authorAgentId: myBoss }),
      makeCandidate({ id: "from-peer", authorAgentId: peer }),
      makeCandidate({ id: "from-stranger", authorAgentId: stranger }),
    ];
    const ranked = rankCandidates(candidates, ctx());
    expect(ranked.map((r) => r.id)).toEqual(["from-boss", "from-peer", "from-stranger"]);
  });

  it("my own memories rank below my manager's memories (slight self-noise penalty)", () => {
    const candidates = [
      makeCandidate({ id: "from-boss", authorAgentId: myBoss }),
      makeCandidate({ id: "from-me", authorAgentId: me }),
    ];
    const ranked = rankCandidates(candidates, ctx());
    expect(ranked[0].id).toBe("from-boss");
  });

  it("human-authored items (authorAgentId null) get neutral org weight", () => {
    const candidates = [
      makeCandidate({ id: "from-human", authorAgentId: null }),
      makeCandidate({ id: "from-stranger", authorAgentId: stranger }),
    ];
    const ranked = rankCandidates(candidates, ctx());
    // human (1.0) > stranger (0.7)
    expect(ranked[0].id).toBe("from-human");
  });

  it("no requestingAgentId disables org weighting entirely", () => {
    const candidates = [
      makeCandidate({ id: "from-boss", authorAgentId: myBoss }),
      makeCandidate({ id: "from-stranger", authorAgentId: stranger }),
    ];
    const ranked = rankCandidates(candidates, { now: FROZEN_NOW });
    // base scores equal, recency equal, org weight = 1.0 for both → tie
    expect(ranked[0].finalScore).toBeCloseTo(ranked[1].finalScore, 5);
  });
});

describe("retrievalRanker — composite formula (HEL-89)", () => {
  it("highest-base item can be beaten by a lower-base item with strong weights", () => {
    const me = "agent-me";
    const boss = "agent-boss";
    const orgGraph = buildOrgGraph([{ managerAgentId: boss, agentId: me }]);
    const candidates = [
      // Plain stranger episode, high base similarity but penalized on layer + org
      makeCandidate({
        id: "high-base-but-penalized",
        baseSimilarity: 0.95,
        layer: "episode",
        authorAgentId: "agent-stranger",
      }),
      // Boss-authored verified knowledge, lower base but heavily boosted
      makeCandidate({
        id: "boss-verified",
        baseSimilarity: 0.6,
        layer: "knowledge",
        kind: "verified",
        authorAgentId: boss,
      }),
    ];
    const ranked = rankCandidates(candidates, {
      now: FROZEN_NOW,
      requestingAgentId: me,
      orgManagersByAgent: orgGraph.managersByAgent,
      orgReportsByAgent: orgGraph.reportsByAgent,
    });
    expect(ranked[0].id).toBe("boss-verified");
  });
});
