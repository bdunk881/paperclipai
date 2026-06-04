/**
 * HEL-563 — the org-chart layout/transform is pure and unit-tested here
 * (the ReactFlow render is exercised by the golden-path E2E).
 */
import { describe, expect, it } from "vitest";
import { buildOrgFlow, type OrgChartSpend } from "./OrgChart";
import type { Agent } from "../api/agentApi";
import type { AgentPresence, AgentPresenceState } from "../hooks/useAgentPresence";

const agents = [
  { id: "ceo", name: "Avery", displayName: "Avery", roleKey: "coo", status: "active" },
  { id: "m1", name: "Morgan", roleKey: "growth-lead", status: "active" },
  { id: "r1", name: "Dana", roleKey: "sdr", status: "active" },
] as unknown as Agent[];

const edges = [
  { id: "e1", managerAgentId: "ceo", agentId: "m1", createdAt: "" },
  { id: "e2", managerAgentId: "m1", agentId: "r1", createdAt: "" },
];

function presenceMap(state: AgentPresenceState, task: string): Map<string, AgentPresence> {
  return new Map([
    [
      "m1",
      { agentId: "m1", workspaceId: "w", state, currentTask: task, since: "", updatedAt: "" },
    ],
  ]);
}

const budgets = new Map<string, OrgChartSpend>([["m1", { spentUsd: 61, monthlyUsd: 200 }]]);

describe("buildOrgFlow (HEL-563)", () => {
  it("builds one node per agent and one edge per org_edge, root at the top", () => {
    const { nodes, edges: fe } = buildOrgFlow(agents, edges, presenceMap("working", "Drafting"), budgets);
    expect(nodes).toHaveLength(3);
    expect(fe).toHaveLength(2);

    const ceo = nodes.find((n) => n.id === "ceo")!;
    const r1 = nodes.find((n) => n.id === "r1")!;
    expect(ceo.position.y).toBe(0); // root at depth 0
    expect(r1.position.y).toBeGreaterThan(ceo.position.y); // report sits below
    expect(ceo.data.name).toBe("Avery");
    expect(ceo.type).toBe("orgAgent");
  });

  it("carries live presence + month-to-date spend into node data", () => {
    const { nodes } = buildOrgFlow(agents, edges, presenceMap("working", "Drafting Q3 outbound"), budgets);
    const m1 = nodes.find((n) => n.id === "m1")!;
    expect(m1.data.presence?.state).toBe("working");
    expect(m1.data.presence?.currentTask).toBe("Drafting Q3 outbound");
    expect(m1.data.spent).toBe(61);
    expect(m1.data.budget).toBe(200);
  });

  it("treats agents with no manager edge as roots and never drops an agent", () => {
    const orphans = [
      { id: "x", name: "X", roleKey: null, status: "active" },
      { id: "y", name: "Y", roleKey: null, status: "active" },
    ] as unknown as Agent[];
    const { nodes, edges: fe } = buildOrgFlow(orphans, [], new Map(), new Map());
    expect(nodes).toHaveLength(2);
    expect(fe).toHaveLength(0);
    expect(nodes.every((n) => n.position.y === 0)).toBe(true);
  });

  it("drops edges that reference an unknown agent (defensive)", () => {
    const { edges: fe } = buildOrgFlow(
      agents,
      [...edges, { id: "bad", managerAgentId: "ceo", agentId: "ghost", createdAt: "" }],
      new Map(),
      new Map(),
    );
    expect(fe).toHaveLength(2);
  });
});
