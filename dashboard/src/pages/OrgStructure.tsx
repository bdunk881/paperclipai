import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listAgents, type Agent } from "../api/agentApi";
import {
  getOrgGraph,
  listBudgets,
  type BudgetRow,
  type OrgGraphAgent,
} from "../api/canonicalApi";
import { listMissions, type Mission } from "../api/missionsApi";
import { AddReportModal } from "../components/missions/AddReportModal";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { AgentCardActions } from "../components/AgentCardActions";
import {
  useAgentPresence,
  type AgentPresence,
} from "../hooks/useAgentPresence";
import OrgStructureListView from "./OrgStructureListView";
import {
  buildListRows,
  buildOrgTree,
  companyIdByAgentId,
  filterAgentsForMission,
  missionIdFromAgent,
  parseViewMode,
  resolveMissionSelection,
  truncateStatement,
  type TeamViewMode,
} from "./orgStructureModel";

/**
 * Team page — Workforce > Team (HEL-26).
 *
 * Org map (default) and list view share mission scope + URL state:
 *   /workspace/org-structure?missionId=<uuid>&view=list
 * Omit missionId for the full workspace roster.
 */

interface AgentSpendRow {
  spentUsd: number;
  monthlyUsd: number;
}

const TONE_ORDER = ["clay", "ink-blue", "plum", "sage", "mustard", "ink"] as const;
type Tone = (typeof TONE_ORDER)[number];

function avatarClassFor(tone: Tone): string {
  if (tone === "ink-blue") return "af2-tone-blue";
  return `af2-tone-${tone}`;
}

function topBorderFor(tone: Tone): string {
  if (tone === "ink-blue") return "var(--af2-ink-blue)";
  return `var(--af2-${tone})`;
}

function toneForIndex(index: number): Tone {
  return TONE_ORDER[index % TONE_ORDER.length];
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MissionNode({ mission, allWorkspace }: { mission: Mission | null; allWorkspace: boolean }) {
  const card = (
      <div
        className="af2-card"
        style={{ padding: 14, width: 280, textAlign: "center" }}
      >
        <div className="af2-eyebrow" style={{ color: "var(--af2-ink-3)" }}>
          {allWorkspace ? "Workspace" : "Mission"}
        </div>
        <div
          className="font-af2-serif"
          style={{ fontSize: 17, marginTop: 4, lineHeight: 1.35, color: "var(--af2-ink)" }}
        >
          {allWorkspace
            ? "All missions"
            : mission
              ? mission.statement
              : "No mission yet"}
        </div>
        {mission && !allWorkspace ? (
          <div className="af2-mono af2-muted-2" style={{ marginTop: 6, fontSize: 11 }}>
            {mission.companyName} · {mission.status}
          </div>
        ) : null}
        {allWorkspace ? (
          <div className="af2-muted" style={{ marginTop: 6, fontSize: 12 }}>
            Showing every agent in this workspace.
          </div>
        ) : null}
      </div>
  );

  if (mission && !allWorkspace) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <Link
          to={`/missions/${encodeURIComponent(mission.id)}`}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          {card}
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
      {card}
    </div>
  );
}

function ConnectorTree({ leadCount }: { leadCount: number }) {
  if (leadCount === 0) return null;
  const branches: number[] = [];
  if (leadCount === 1) {
    branches.push(50);
  } else if (leadCount === 2) {
    branches.push(25, 75);
  } else {
    branches.push(16, 50, 84);
  }
  return (
    <svg
      width="100%"
      height="40"
      style={{ display: "block", marginBottom: 6 }}
      aria-hidden="true"
    >
      {branches.map((x, i) => (
        <path
          key={i}
          d={`M50% 0 V20 H${x}% V40`}
          stroke="var(--af2-line-2)"
          strokeWidth="1"
          fill="none"
        />
      ))}
    </svg>
  );
}

interface LeadStats {
  spentUsd: number;
  budgetUsd: number;
}

function PodLead({
  lead,
  reports,
  tone,
  leadStats,
  reportStats,
  presence,
  onAddReport,
}: {
  lead: Agent;
  reports: Agent[];
  tone: Tone;
  leadStats: LeadStats | null;
  reportStats: Map<string, AgentSpendRow>;
  presence: Map<string, AgentPresence>;
  onAddReport: (lead: Agent) => void;
}) {
  const avatarClass = avatarClassFor(tone);
  const borderColor = topBorderFor(tone);
  const teamSize = reports.length + 1;
  const spentLabel =
    leadStats !== null
      ? `$${leadStats.spentUsd.toFixed(0)}`
      : lead.budgetMonthlyUsd > 0
        ? "$0"
        : "—";
  const budgetLabel =
    leadStats !== null
      ? `$${leadStats.budgetUsd.toFixed(0)}`
      : lead.budgetMonthlyUsd > 0
        ? `$${lead.budgetMonthlyUsd.toFixed(0)}`
        : "—";

  return (
    <div>
      <Link
        to={`/agents/${encodeURIComponent(lead.id)}`}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div
          className="af2-card"
          style={{
            padding: 16,
            borderTop: `3px solid ${borderColor}`,
            cursor: "pointer",
          }}
        >
          <div className="af2-row" style={{ gap: 12 }}>
            <div className={`af2-avatar lg ${avatarClass}`}>
              {initialsFor(lead.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--af2-ink)" }}>
                  {lead.name}
                </span>
                <AgentPresencePill presence={presence.get(lead.id)} />
              </div>
              <div className="af2-muted" style={{ fontSize: 12 }}>
                {lead.roleKey ?? "—"}
              </div>
              {lead.model ? (
                <div
                  className="af2-mono"
                  style={{ fontSize: 11, color: "var(--af2-ink-3)", marginTop: 4 }}
                >
                  {lead.model}
                </div>
              ) : null}
            </div>
          </div>
          <div className="af2-row" style={{ marginTop: 12, gap: 14, fontSize: 12 }}>
            <div>
              <strong>{teamSize}</strong> <span className="af2-muted">reports</span>
            </div>
            <div>
              <strong>{spentLabel}</strong>{" "}
              <span className="af2-muted">/ {budgetLabel}</span>
            </div>
          </div>
        </div>
      </Link>

      <div style={{ marginTop: 8 }}>
        <AgentCardActions agent={{ id: lead.id, name: lead.name }} />
      </div>

      <div
        style={{
          marginTop: 10,
          marginLeft: 18,
          borderLeft: "1px dashed var(--af2-line-2)",
          paddingLeft: 14,
        }}
      >
        {reports.map((report) => {
          const snap = reportStats.get(report.id) ?? null;
          const reportSpend =
            snap !== null
              ? `$${snap.spentUsd.toFixed(0)}`
              : report.budgetMonthlyUsd > 0
                ? `$${report.budgetMonthlyUsd.toFixed(0)}`
                : null;
          return (
            <div
              key={report.id}
              className="af2-card"
              style={{
                padding: 10,
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Link
                to={`/agents/${encodeURIComponent(report.id)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div className={`af2-avatar sm ${avatarClassFor(tone)}`} aria-hidden="true">
                  {initialsFor(report.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 500, fontSize: 13, color: "var(--af2-ink)" }}>
                      {report.name}
                    </span>
                    <AgentPresencePill presence={presence.get(report.id)} />
                  </div>
                  <div className="af2-muted" style={{ fontSize: 11.5 }}>
                    {report.roleKey ?? "—"}
                  </div>
                </div>
                {reportSpend ? (
                  <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                    {reportSpend}
                  </span>
                ) : null}
              </Link>
              <AgentCardActions agent={{ id: report.id, name: report.name }} compact />
            </div>
          );
        })}
        <button
          type="button"
          className="af2-btn af2-btn-ghost af2-btn-sm"
          style={{
            marginTop: 8,
            width: "100%",
            display: "inline-flex",
            justifyContent: "center",
          }}
          onClick={() => onAddReport(lead)}
        >
          ＋ Add report
        </button>
      </div>
    </div>
  );
}

export default function OrgStructure() {
  const { accessMode, getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const presence = useAgentPresence();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [orgGraphAgents, setOrgGraphAgents] = useState<OrgGraphAgent[]>([]);
  const [edges, setEdges] = useState<Array<{ managerAgentId: string; agentId: string }> | null>(
    null,
  );
  const [budgets, setBudgets] = useState<Map<string, AgentSpendRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addReportLead, setAddReportLead] = useState<Agent | null>(null);

  const viewMode: TeamViewMode = parseViewMode(searchParams.get("view"));
  const missionIdParam = searchParams.get("missionId");

  const writeParam = useCallback(
    (key: "view" | "missionId", value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (key === "view") {
        if (!value || value === "map") {
          next.delete("view");
        } else {
          next.set("view", value);
        }
      } else if (!value || value === "all") {
        next.delete("missionId");
      } else {
        next.set("missionId", value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (accessMode === "preview" && !token) {
        setAgents([]);
        setMissions([]);
        setOrgGraphAgents([]);
        setEdges(null);
        setBudgets(new Map());
        return;
      }
      if (!token) throw new Error("Authentication session expired.");
      const [nextAgents, nextMissions, orgGraph, budgetRows] = await Promise.all([
        listAgents(token),
        listMissions(token),
        getOrgGraph(token).catch(() => ({ workspaceId: null, agents: [], edges: [] })),
        listBudgets(token).catch(() => [] as BudgetRow[]),
      ]);
      setAgents(nextAgents);
      setMissions(nextMissions);
      setOrgGraphAgents(orgGraph.agents);
      setEdges(orgGraph.edges);

      const budgetMap = new Map<string, AgentSpendRow>();
      for (const row of budgetRows) {
        if (row.scopeKind === "agent" && row.scopeId) {
          budgetMap.set(row.scopeId, {
            spentUsd: row.usedCents / 100,
            monthlyUsd: row.capCents / 100,
          });
        }
      }
      setBudgets(budgetMap);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load org structure");
    } finally {
      setLoading(false);
    }
  }, [accessMode, getAccessToken]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  const { selectedMissionId, selectedMission, scopeAllWorkspace } = useMemo(
    () => resolveMissionSelection(missions, missionIdParam),
    [missions, missionIdParam],
  );

  const filteredAgents = useMemo(
    () =>
      filterAgentsForMission(
        agents,
        scopeAllWorkspace ? null : selectedMissionId,
        scopeAllWorkspace ? null : selectedMission,
        companyIdByAgentId(orgGraphAgents),
      ),
    [agents, scopeAllWorkspace, selectedMissionId, selectedMission, orgGraphAgents],
  );

  const tree = useMemo(
    () => buildOrgTree(filteredAgents, edges),
    [filteredAgents, edges],
  );

  const listRows = useMemo(() => buildListRows(tree), [tree]);

  const leadStatsFor = useCallback(
    (agentId: string): LeadStats | null => {
      const snap = budgets.get(agentId);
      if (!snap) return null;
      return { spentUsd: snap.spentUsd, budgetUsd: snap.monthlyUsd };
    },
    [budgets],
  );

  const pageMeta = useMemo(() => {
    if (agents.length === 0) {
      return "Define your first mission to start hiring.";
    }
    const podCount = tree.rootAgents.length;
    const scopeLabel = scopeAllWorkspace
      ? "across workspace"
      : selectedMission
        ? `on “${truncateStatement(selectedMission.statement, 48)}”`
        : "on this mission";
    return `${filteredAgents.length} agent${filteredAgents.length === 1 ? "" : "s"} ${scopeLabel} · ${podCount} pod${podCount === 1 ? "" : "s"}. Click a name to brief.`;
  }, [
    agents.length,
    filteredAgents.length,
    scopeAllWorkspace,
    selectedMission,
    tree.rootAgents.length,
  ]);

  const missionSelectValue = scopeAllWorkspace ? "all" : (selectedMissionId ?? "all");

  const existingRoleKeys = useMemo(
    () =>
      new Set(
        filteredAgents
          .map((a) => a.roleKey)
          .filter((key): key is string => typeof key === "string" && key.length > 0),
      ),
    [filteredAgents],
  );

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Mapping the org graph..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadOrg()} />
      </div>
    );
  }

  const podCount = tree.rootAgents.length;
  const showMissionEmpty =
    !scopeAllWorkspace && selectedMission && filteredAgents.length === 0 && agents.length > 0;

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Team
          </h1>
          <div className="af2-page-head-meta">{pageMeta}</div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/hire"
            className="af2-btn af2-btn-primary"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ＋ Hire
          </Link>
        </div>
      </div>

      {agents.length > 0 ? (
        <>
          <div
            className="af2-row"
            style={{ marginBottom: 14, gap: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            <label className="af2-muted" style={{ fontSize: 12 }} htmlFor="team-mission-select">
              Mission
            </label>
            <select
              id="team-mission-select"
              className="af2-input"
              style={{ minWidth: 280, maxWidth: "100%", flex: "1 1 280px" }}
              value={missionSelectValue}
              onChange={(event) => {
                const value = event.target.value;
                writeParam("missionId", value === "all" ? "all" : value);
              }}
            >
              <option value="all">All workspace</option>
              {missions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {truncateStatement(mission.statement)} · {mission.status}
                </option>
              ))}
            </select>
          </div>

          <div className="af2-tabs" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={`af2-tab${viewMode === "map" ? " active" : ""}`}
              onClick={() => writeParam("view", "map")}
            >
              Org map
            </button>
            <button
              type="button"
              className={`af2-tab${viewMode === "list" ? " active" : ""}`}
              onClick={() => writeParam("view", "list")}
            >
              List view
            </button>
          </div>
        </>
      ) : null}

      {agents.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <div style={{ maxWidth: 480, width: "100%" }}>
            <EmptyState
              title="No team yet"
              description="Define your first mission to start hiring."
              ctaLabel="＋ Hire"
              ctaTo="/hire"
            />
          </div>
        </div>
      ) : showMissionEmpty ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <div style={{ maxWidth: 480, width: "100%" }}>
            <EmptyState
              title="No agents on this mission"
              description="Confirm a hiring plan for this mission to provision your team, or switch to All workspace."
              ctaLabel={
                selectedMission?.latestHiringPlanId ? "Review hiring plan" : "＋ Hire"
              }
              ctaTo={
                selectedMission?.latestHiringPlanId
                  ? `/hire/plan/${selectedMission.id}/${selectedMission.latestHiringPlanId}`
                  : "/hire"
              }
            />
          </div>
        </div>
      ) : viewMode === "list" ? (
        <OrgStructureListView rows={listRows} budgets={budgets} presence={presence} />
      ) : (
        <>
          <MissionNode mission={selectedMission} allWorkspace={scopeAllWorkspace} />
          <ConnectorTree leadCount={podCount} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, podCount))}, 1fr)`,
              gap: 18,
            }}
          >
            {tree.rootAgents.map((lead, index) => (
              <PodLead
                key={lead.id}
                lead={lead}
                reports={tree.reportsByLeadId.get(lead.id) ?? []}
                tone={toneForIndex(index)}
                leadStats={leadStatsFor(lead.id)}
                reportStats={budgets}
                presence={presence}
                onAddReport={setAddReportLead}
              />
            ))}
          </div>
        </>
      )}

      {addReportLead ? (() => {
        const missionForReport =
          selectedMission ??
          missions.find((m) => m.id === missionIdFromAgent(addReportLead)) ??
          null;
        if (!missionForReport) return null;
        const planConfirmed =
          missionForReport.status === "active" ||
          missionForReport.status === "in_flight" ||
          missionForReport.status === "running" ||
          missionForReport.status === "blocked";
        return (
          <AddReportModal
            open
            onClose={() => setAddReportLead(null)}
            missionId={missionForReport.id}
            managerAgentId={addReportLead.id}
            managerName={addReportLead.name}
            managerRoleKey={addReportLead.roleKey ?? null}
            existingRoleKeys={existingRoleKeys}
            hiringPlanId={missionForReport.latestHiringPlanId}
            planConfirmed={planConfirmed}
            onAdded={() => void loadOrg()}
          />
        );
      })() : null}
    </div>
  );
}
