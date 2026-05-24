import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Agent } from "../api/agentApi";
import { retireMissionTeam, type Mission } from "../api/missionsApi";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useBudgetsQuery } from "../hooks/queries/useBudgetsQuery";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";
import { useOrgGraphQuery } from "../hooks/queries/useOrgGraphQuery";
import { AddReportModal } from "../components/missions/AddReportModal";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";
import { EmptyState, ErrorState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
// HEL-214 / PR J: Pro Mode actionable reveal.
import { ProReveal } from "../components/pro/ProReveal";
import { ToolCallSandbox } from "../components/pro/ToolCallSandbox";
import { useToast } from "../components/ToastProvider";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { AgentCardActions } from "../components/AgentCardActions";
import { Af2RowDrawer } from "../components/Af2RowDrawer";
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

/**
 * HEL-210 — primary label for an agent. When the owner has set a
 * `display_name` we render that as the headline and let `roleKey`
 * fall through to the subtitle.
 */
function primaryAgentLabel(agent: Agent): string {
  return agent.displayName?.trim() || agent.name;
}

function agentSubtitle(agent: Agent): string {
  if (agent.displayName?.trim()) return agent.roleKey ?? "—";
  return agent.roleKey && agent.roleKey !== agent.name ? agent.roleKey : "—";
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
              {initialsFor(primaryAgentLabel(lead))}
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
                  {primaryAgentLabel(lead)}
                </span>
                <AgentPresencePill presence={presence.get(lead.id)} />
              </div>
              <div className="af2-muted" style={{ fontSize: 12 }}>
                {agentSubtitle(lead)}
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
        <AgentCardActions agent={{ id: lead.id, name: primaryAgentLabel(lead) }} />
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
                  {initialsFor(primaryAgentLabel(report))}
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
                      {primaryAgentLabel(report)}
                    </span>
                    <AgentPresencePill presence={presence.get(report.id)} />
                  </div>
                  <div className="af2-muted" style={{ fontSize: 11.5 }}>
                    {agentSubtitle(report)}
                  </div>
                </div>
                {reportSpend ? (
                  <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                    {reportSpend}
                  </span>
                ) : null}
              </Link>
              <AgentCardActions agent={{ id: report.id, name: primaryAgentLabel(report) }} compact />
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
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const presence = useAgentPresence();
  const agentsQuery = useAgentsQuery();
  const missionsQuery = useMissionsQuery();
  const orgGraphQuery = useOrgGraphQuery();
  const budgetsQuery = useBudgetsQuery();
  const agents = agentsQuery.data ?? [];
  const missions = missionsQuery.data ?? [];
  const orgGraphAgents = orgGraphQuery.data?.agents ?? [];
  const edges = orgGraphQuery.data?.edges ?? null;

  // HEL-210 filter-bar state.
  const searchQuery = (searchParams.get("q") ?? "").trim();
  const statusFilter = searchParams.get("status") ?? "all";
  const showArchived = searchParams.get("archived") === "1";
  const [retireTeamTarget, setRetireTeamTarget] = useState<Mission | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [agentDrawerTab, setAgentDrawerTab] = useState<
    "overview" | "job" | "standing" | "budget"
  >("overview");
  const budgets = useMemo(() => {
    const budgetMap = new Map<string, AgentSpendRow>();
    for (const row of budgetsQuery.data ?? []) {
      if (row.scopeKind === "agent" && row.scopeId) {
        budgetMap.set(row.scopeId, {
          spentUsd: row.usedCents / 100,
          monthlyUsd: row.capCents / 100,
        });
      }
    }
    return budgetMap;
  }, [budgetsQuery.data]);
  const loading =
    (agentsQuery.isLoading || missionsQuery.isLoading) &&
    !agentsQuery.data &&
    !missionsQuery.data;
  const error =
    agentsQuery.error instanceof Error
      ? agentsQuery.error.message
      : missionsQuery.error instanceof Error
        ? missionsQuery.error.message
        : null;
  const [addReportLead, setAddReportLead] = useState<Agent | null>(null);

  const viewMode: TeamViewMode = parseViewMode(searchParams.get("view"));
  const missionIdParam = searchParams.get("missionId");

  const writeParam = useCallback(
    (key: "view" | "missionId" | "q" | "status" | "archived", value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (key === "view") {
        if (!value || value === "map") next.delete("view");
        else next.set("view", value);
      } else if (key === "missionId") {
        if (!value || value === "all") next.delete("missionId");
        else next.set("missionId", value);
      } else if (key === "status") {
        if (!value || value === "all") next.delete("status");
        else next.set("status", value);
      } else if (key === "q") {
        if (!value) next.delete("q");
        else next.set("q", value);
      } else if (key === "archived") {
        if (value === "1") next.set("archived", "1");
        else next.delete("archived");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const refreshOrg = useCallback(() => {
    void agentsQuery.refetch();
    void missionsQuery.refetch();
    void orgGraphQuery.refetch();
    void budgetsQuery.refetch();
  }, [agentsQuery, missionsQuery, orgGraphQuery, budgetsQuery]);

  const { selectedMissionId, selectedMission, scopeAllWorkspace } = useMemo(
    () => resolveMissionSelection(missions, missionIdParam),
    [missions, missionIdParam],
  );

  const filteredAgents = useMemo(() => {
    const base = filterAgentsForMission(
      agents,
      scopeAllWorkspace ? null : selectedMissionId,
      scopeAllWorkspace ? null : selectedMission,
      companyIdByAgentId(orgGraphAgents),
    );
    const q = searchQuery.toLowerCase();
    return base.filter((agent) => {
      if (!showArchived && agent.status === "idle" && !(agent.lastHeartbeatAt || agent.lastRunAt)) {
        return false;
      }
      if (statusFilter !== "all" && agent.status !== statusFilter) {
        return false;
      }
      if (q) {
        const hay = `${primaryAgentLabel(agent)} ${agent.name} ${agent.roleKey ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    agents,
    scopeAllWorkspace,
    selectedMissionId,
    selectedMission,
    orgGraphAgents,
    searchQuery,
    statusFilter,
    showArchived,
  ]);

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

  if (error && !agents.length && !missions.length) {
    return (
      <div className="af2-page">
        <ErrorState title="Signal Lost" message={error} onRetry={refreshOrg} />
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
          <div className="af2-page-head-meta">
            {loading ? <SkeletonBlock lines={1} /> : pageMeta}
          </div>
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
          {/* HEL-210: filter bar — search · status · team · archived */}
          <div
            className="af2-row"
            style={{ marginBottom: 14, gap: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            <input
              type="search"
              className="af2-input"
              placeholder="Search agents…"
              value={searchQuery}
              onChange={(event) => writeParam("q", event.target.value)}
              style={{ minWidth: 200, flex: "1 1 240px" }}
              aria-label="Search agents"
            />
            <select
              className="af2-input"
              value={statusFilter}
              onChange={(event) => writeParam("status", event.target.value)}
              style={{ minWidth: 130 }}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="idle">Idle</option>
              <option value="error">Blocked</option>
            </select>
            <label className="af2-muted" style={{ fontSize: 12 }} htmlFor="team-mission-select">
              Team
            </label>
            <select
              id="team-mission-select"
              className="af2-input"
              style={{ minWidth: 220, maxWidth: "100%", flex: "1 1 220px" }}
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
            <label
              className="af2-row"
              style={{ gap: 6, fontSize: 12, color: "var(--af2-ink-3)", alignItems: "center" }}
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => writeParam("archived", e.target.checked ? "1" : null)}
              />
              Show archived
            </label>
          </div>

          {/* HEL-210: team header row-actions visible when scoped to one mission. */}
          {!scopeAllWorkspace && selectedMission ? (
            <div
              className="af2-row"
              style={{ marginBottom: 14, gap: 8, flexWrap: "wrap", alignItems: "center" }}
            >
              <span className="af2-muted" style={{ fontSize: 12 }}>
                Team actions:
              </span>
              <button
                type="button"
                className="af2-btn af2-btn-sm"
                onClick={() => {
                  const firstLead = tree.rootAgents[0] ?? null;
                  if (firstLead) setAddReportLead(firstLead);
                  else
                    toast.error(
                      "No team lead yet — confirm a hiring plan before adding agents.",
                    );
                }}
              >
                ＋ Add agent
              </button>
              <button
                type="button"
                className="af2-btn af2-btn-sm"
                onClick={() => {
                  // TODO(HEL-210 follow-up): wire explicit archive-team mutation.
                  toast.info("Archive team flow lives on the mission detail page.");
                }}
              >
                Archive team
              </button>
              <button
                type="button"
                className="af2-btn af2-btn-sm"
                style={{ color: "var(--af2-clay)" }}
                aria-label="Fire team"
                onClick={() => setRetireTeamTarget(selectedMission)}
              >
                Fire team
              </button>
            </div>
          ) : null}

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
        <OrgStructureListView
          rows={listRows}
          budgets={budgets}
          presence={presence}
          onAgentClick={(id) => {
            setOpenAgentId(id);
            setAgentDrawerTab("overview");
          }}
        />
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
            managerName={primaryAgentLabel(addReportLead)}
            managerRoleKey={addReportLead.roleKey ?? null}
            existingRoleKeys={existingRoleKeys}
            hiringPlanId={missionForReport.latestHiringPlanId}
            planConfirmed={planConfirmed}
            onAdded={refreshOrg}
          />
        );
      })() : null}

      {/* HEL-210 — "Fire team" confirm. Reuses retireMissionTeam from PR #956. */}
      <ConfirmDestructiveModal
        open={retireTeamTarget !== null}
        onClose={() => {
          if (!retiring) setRetireTeamTarget(null);
        }}
        eyebrow="Fire team"
        title="Fire this team?"
        message={
          retireTeamTarget
            ? `"${truncateStatement(retireTeamTarget.statement, 140)}" — this terminates every agent on the mission and clears org edges. You can re-hire later.`
            : ""
        }
        confirmLabel="Fire team"
        confirming={retiring}
        onConfirm={async () => {
          if (!retireTeamTarget) return;
          setRetiring(true);
          try {
            const token = await requireAccessToken();
            const result = await retireMissionTeam(retireTeamTarget.id, token);
            toast.success(
              `Team retired (${result.retiredAgentCount} agent${result.retiredAgentCount === 1 ? "" : "s"}).`,
            );
            setRetireTeamTarget(null);
            refreshOrg();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to retire team");
          } finally {
            setRetiring(false);
          }
        }}
      />

      {/* HEL-210 — inline agent drawer (opens from the list view onAgentClick). */}
      {(() => {
        const agent = openAgentId
          ? filteredAgents.find((a) => a.id === openAgentId) ?? null
          : null;
        if (!agent) return null;
        return (
          <Af2RowDrawer
            open
            onClose={() => setOpenAgentId(null)}
            ariaLabel={`Agent ${primaryAgentLabel(agent)} details`}
          >
            <div style={{ padding: "14px 20px 18px" }}>
              <div className="af2-row" style={{ gap: 10, marginBottom: 10 }}>
                <strong style={{ fontSize: 15 }}>{primaryAgentLabel(agent)}</strong>
                <span className="af2-muted" style={{ fontSize: 12 }}>
                  · {agentSubtitle(agent)}
                </span>
              </div>
              <div
                className="af2-tabs"
                role="tablist"
                aria-label="Agent details"
                style={{ marginBottom: 12 }}
              >
                {(
                  [
                    { key: "overview", label: "Overview" },
                    { key: "job", label: "Job" },
                    { key: "standing", label: "Standing Tasks" },
                    { key: "budget", label: "Budget" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={agentDrawerTab === t.key}
                    className={`af2-tab${agentDrawerTab === t.key ? " active" : ""}`}
                    onClick={() => setAgentDrawerTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {agentDrawerTab === "overview" ? (
                <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Role · {agent.roleKey ?? "—"}
                  <br />
                  Model · {agent.model ?? "—"}
                  <br />
                  Status · {agent.status}
                  <br />
                  Budget · ${agent.budgetMonthlyUsd.toFixed(0)}/mo
                  <div style={{ marginTop: 8 }}>
                    <Link
                      to={`/agents/${encodeURIComponent(agent.id)}`}
                      className="af2-btn af2-btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      Open full detail →
                    </Link>
                  </div>
                </div>
              ) : agentDrawerTab === "job" ? (
                <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Job description lives on the{" "}
                  <Link
                    to={`/agents/${encodeURIComponent(agent.id)}/job-description`}
                    style={{ color: "var(--af2-sage)" }}
                  >
                    Job page
                  </Link>
                  .
                </div>
              ) : agentDrawerTab === "standing" ? (
                <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Standing tasks for this agent open on the{" "}
                  <Link
                    to={`/agents/${encodeURIComponent(agent.id)}/standing-tasks`}
                    style={{ color: "var(--af2-sage)" }}
                  >
                    Standing Tasks page
                  </Link>
                  .
                </div>
              ) : (
                <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Spend / cap lives on the{" "}
                  <Link
                    to={`/budget?agentId=${encodeURIComponent(agent.id)}`}
                    style={{ color: "var(--af2-sage)" }}
                  >
                    Budget page
                  </Link>
                  .
                </div>
              )}
            </div>
          </Af2RowDrawer>
        );
      })()}
      <ProReveal
        label="Tool-call sandbox"
        description="Pick a tool from an agent's allowlist and fire it with synthetic input."
      >
        <ToolCallSandbox />
      </ProReveal>
    </div>
  );
}
