import type { Agent } from "../api/agentApi";
import type { OrgGraphAgent } from "../api/canonicalApi";
import type { Mission } from "../api/missionsApi";

export type TeamViewMode = "map" | "list";

export function parseViewMode(value: string | null): TeamViewMode {
  return value === "list" ? "list" : "map";
}

export function missionIdFromAgent(agent: Agent): string | null {
  const raw = agent.metadata?.missionId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function resolveMissionSelection(
  missions: Mission[],
  missionIdParam: string | null,
): {
  selectedMissionId: string | null;
  selectedMission: Mission | null;
  scopeAllWorkspace: boolean;
} {
  if (!missionIdParam || missionIdParam === "all") {
    return { selectedMissionId: null, selectedMission: null, scopeAllWorkspace: true };
  }
  const match = missions.find((m) => m.id === missionIdParam);
  if (match) {
    return {
      selectedMissionId: match.id,
      selectedMission: match,
      scopeAllWorkspace: false,
    };
  }
  return { selectedMissionId: null, selectedMission: null, scopeAllWorkspace: true };
}

export function companyIdByAgentId(orgGraphAgents: OrgGraphAgent[]): Map<string, string | null> {
  return new Map(orgGraphAgents.map((a) => [a.id, a.companyId]));
}

export function filterAgentsForMission(
  agents: Agent[],
  selectedMissionId: string | null,
  selectedMission: Mission | null,
  companyIds: Map<string, string | null>,
): Agent[] {
  if (!selectedMissionId) {
    return agents;
  }
  const tagged = agents.some((agent) => missionIdFromAgent(agent) !== null);
  if (tagged) {
    return agents.filter((agent) => missionIdFromAgent(agent) === selectedMissionId);
  }
  if (selectedMission) {
    return agents.filter(
      (agent) => companyIds.get(agent.id) === selectedMission.companyId,
    );
  }
  return agents;
}

export interface OrgTreeShape {
  rootAgents: Agent[];
  reportsByLeadId: Map<string, Agent[]>;
}

function managerIdFromMetadata(agent: Agent): string | null {
  const metadata = agent.metadata ?? {};
  const manager =
    (metadata as Record<string, unknown>).reportingToAgentId ??
    (metadata as Record<string, unknown>).managerAgentId ??
    (metadata as Record<string, unknown>).parentAgentId;
  return typeof manager === "string" && manager.length > 0 ? manager : null;
}

export function buildOrgTree(
  agents: Agent[],
  edges: Array<{ managerAgentId: string; agentId: string }> | null,
): OrgTreeShape {
  const reportsByLeadId = new Map<string, Agent[]>();
  const reportIds = new Set<string>();
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const pushReport = (managerId: string, report: Agent) => {
    reportsByLeadId.set(managerId, [...(reportsByLeadId.get(managerId) ?? []), report]);
    reportIds.add(report.id);
  };

  if (edges && edges.length > 0) {
    for (const edge of edges) {
      const report = agentById.get(edge.agentId);
      if (!report) continue;
      if (!agentById.has(edge.managerAgentId)) continue;
      pushReport(edge.managerAgentId, report);
    }
  } else {
    for (const agent of agents) {
      const managerId = managerIdFromMetadata(agent);
      if (!managerId) continue;
      if (!agentById.has(managerId)) continue;
      pushReport(managerId, agent);
    }
  }

  const rootAgents = agents
    .filter((agent) => !reportIds.has(agent.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rootAgents, reportsByLeadId };
}

export interface ListRow {
  agent: Agent;
  managerName: string | null;
  depth: number;
}

export function buildListRows(tree: OrgTreeShape): ListRow[] {
  const rows: ListRow[] = [];
  for (const lead of tree.rootAgents) {
    rows.push({ agent: lead, managerName: null, depth: 0 });
    const reports = tree.reportsByLeadId.get(lead.id) ?? [];
    for (const report of [...reports].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ agent: report, managerName: lead.name, depth: 1 });
    }
  }
  return rows;
}

export function truncateStatement(statement: string, max = 72): string {
  const trimmed = statement.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
