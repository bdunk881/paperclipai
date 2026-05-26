import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Agent } from "../api/agentApi";
import { retireMissionTeam, type Mission } from "../api/missionsApi";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useBudgetsQuery } from "../hooks/queries/useBudgetsQuery";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";
import { useOrgGraphQuery } from "../hooks/queries/useOrgGraphQuery";
import { AddReportModal } from "../components/missions/AddReportModal";
import { EmptyState, ErrorState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useToast } from "../components/ToastProvider";
import {
  useAgentPresence,
  type AgentPresence,
} from "../hooks/useAgentPresence";
import {
  buildListRows,
  buildOrgTree,
  companyIdByAgentId,
  filterAgentsForMission,
  missionIdFromAgent,
  resolveMissionSelection,
  truncateStatement,
} from "./orgStructureModel";

/**
 * Team page — Workforce > Team (HEL-26, v2 prototype port).
 *
 * v2 prototype port: docs/design/v2/preview/consolidation.html lines 713-785.
 */

interface AgentSpendRow {
  spentUsd: number;
  monthlyUsd: number;
}

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "A"
  );
}

function primaryAgentLabel(agent: Agent): string {
  return agent.displayName?.trim() || agent.name;
}

function agentSubtitle(agent: Agent): string {
  if (agent.displayName?.trim()) return agent.roleKey ?? "—";
  return agent.roleKey && agent.roleKey !== agent.name ? agent.roleKey : "—";
}

function presenceClass(presence: AgentPresence | undefined): string {
  if (!presence) return "pill dot";
  const tone =
    presence.state === "working"
      ? "sage"
      : presence.state === "idle" || presence.state === "checking-in"
        ? "mustard"
        : presence.state === "blocked"
          ? "clay"
          : "";
  return `pill dot ${tone}`.trim();
}

function presenceLabel(presence: AgentPresence | undefined): string {
  if (!presence) return "unknown";
  if (presence.state === "working") return "active";
  return presence.state;
}

function tierPillFor(agent: Agent): { label: string; tone: string } {
  // Treat presence of a model + budget as a "power tier" heuristic — purely
  // cosmetic to match the prototype's tier pill.
  const isPower = agent.budgetMonthlyUsd >= 300;
  return { label: isPower ? "power tier" : "standard tier", tone: "" };
}

// Group filtered agents by mission id so we can render a per-team header
// card + agent row-list, matching the prototype's repeated team blocks.
interface TeamGroup {
  mission: Mission | null;
  managerName: string | null;
  agents: Agent[];
}

function groupAgentsByTeam(
  agents: Agent[],
  missions: Mission[],
): TeamGroup[] {
  const byMissionId = new Map<string, Agent[]>();
  const unassigned: Agent[] = [];
  for (const agent of agents) {
    const missionId = missionIdFromAgent(agent);
    if (missionId) {
      const list = byMissionId.get(missionId) ?? [];
      list.push(agent);
      byMissionId.set(missionId, list);
    } else {
      unassigned.push(agent);
    }
  }
  const groups: TeamGroup[] = [];
  for (const mission of missions) {
    const list = byMissionId.get(mission.id);
    if (!list || list.length === 0) continue;
    // Pick the highest-budget agent as the manager.
    const manager =
      [...list].sort(
        (a, b) => (b.budgetMonthlyUsd ?? 0) - (a.budgetMonthlyUsd ?? 0),
      )[0] ?? null;
    groups.push({
      mission,
      managerName: manager ? primaryAgentLabel(manager) : null,
      agents: list,
    });
  }
  if (unassigned.length > 0) {
    const manager =
      [...unassigned].sort(
        (a, b) => (b.budgetMonthlyUsd ?? 0) - (a.budgetMonthlyUsd ?? 0),
      )[0] ?? null;
    groups.push({
      mission: null,
      managerName: manager ? primaryAgentLabel(manager) : null,
      agents: unassigned,
    });
  }
  return groups;
}

function teamLabel(group: TeamGroup): string {
  if (!group.mission) return "Unassigned";
  return truncateStatement(group.mission.statement, 40);
}

function isArchivedMission(mission: Mission | null): boolean {
  if (!mission) return false;
  return mission.status === "completed" || mission.status === "archived";
}

// LocalStorage prefix for persisting the user's preferred team order
// and per-team collapsed state. There's no backend equivalent today.
const ORG_STORAGE_PREFIX = "af2.orgStructure.v1";

function loadCollapsedTeams(workspaceId: string | null): Set<string> {
  if (typeof window === "undefined" || !workspaceId) return new Set();
  try {
    const raw = window.localStorage.getItem(
      `${ORG_STORAGE_PREFIX}.${workspaceId}.collapsed`,
    );
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedTeams(workspaceId: string | null, ids: Set<string>) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${ORG_STORAGE_PREFIX}.${workspaceId}.collapsed`,
      JSON.stringify([...ids]),
    );
  } catch {
    /* ignore quota errors */
  }
}

function loadAgentOrder(workspaceId: string | null, teamKey: string): string[] {
  if (typeof window === "undefined" || !workspaceId) return [];
  try {
    const raw = window.localStorage.getItem(
      `${ORG_STORAGE_PREFIX}.${workspaceId}.team.${teamKey}.agentOrder`,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveAgentOrder(
  workspaceId: string | null,
  teamKey: string,
  order: string[],
) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${ORG_STORAGE_PREFIX}.${workspaceId}.team.${teamKey}.agentOrder`,
      JSON.stringify(order),
    );
  } catch {
    /* ignore quota errors */
  }
}

function applyAgentOrder(agents: Agent[], order: string[]): Agent[] {
  if (order.length === 0) return agents;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const ordered: Agent[] = [];
  for (const id of order) {
    const a = byId.get(id);
    if (a) {
      ordered.push(a);
      byId.delete(id);
    }
  }
  for (const remaining of byId.values()) ordered.push(remaining);
  return ordered;
}

function teamStorageKey(group: TeamGroup, idx: number): string {
  return group.mission?.id ?? `unassigned-${idx}`;
}

export default function OrgStructure() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const presence = useAgentPresence();
  const agentsQuery = useAgentsQuery();
  const missionsQuery = useMissionsQuery();
  const orgGraphQuery = useOrgGraphQuery();
  const budgetsQuery = useBudgetsQuery();

  // Persisted UI prefs — collapsed teams + intra-team agent order.
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(() =>
    loadCollapsedTeams(activeWorkspaceId ?? null),
  );
  useEffect(() => {
    setCollapsedTeams(loadCollapsedTeams(activeWorkspaceId ?? null));
  }, [activeWorkspaceId]);

  function toggleTeamCollapsed(key: string) {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedTeams(activeWorkspaceId ?? null, next);
      return next;
    });
  }

  // Per-team agent ordering. Drag handle on each agent row updates the
  // order; we persist it in localStorage scoped to (workspace, team).
  const [dragAgentId, setDragAgentId] = useState<string | null>(null);
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null);
  const [agentOrderByTeam, setAgentOrderByTeam] = useState<Record<string, string[]>>(
    {},
  );

  function reorderAgentsInTeam(teamKey: string, sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setAgentOrderByTeam((prev) => {
      const current = prev[teamKey] ?? [];
      const next = current.length > 0 ? [...current] : [];
      // If we don't have a baseline yet, fall back to the visible order
      // captured on drag start. (We use document.querySelector to read
      // the rendered DOM order — cheap and correct.)
      if (next.length === 0) {
        const nodes = document.querySelectorAll<HTMLElement>(
          `[data-agent-row][data-team-key="${teamKey}"]`,
        );
        nodes.forEach((node) => {
          const id = node.getAttribute("data-agent-id");
          if (id) next.push(id);
        });
      }
      const fromIdx = next.indexOf(sourceId);
      const toIdx = next.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, sourceId);
      saveAgentOrder(activeWorkspaceId ?? null, teamKey, next);
      return { ...prev, [teamKey]: next };
    });
  }
  const agents = agentsQuery.data ?? [];
  const missions = missionsQuery.data ?? [];
  const orgGraphAgents = orgGraphQuery.data?.agents ?? [];
  const edges = orgGraphQuery.data?.edges ?? null;

  const searchQuery = (searchParams.get("q") ?? "").trim();
  const statusFilter = searchParams.get("status") ?? "all";
  // "active" (default), "archived", "all"
  const segFilter = (searchParams.get("seg") ?? "active") as
    | "active"
    | "archived"
    | "all";
  const [retireTeamTarget, setRetireTeamTarget] = useState<Mission | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [agentDrawerTab, setAgentDrawerTab] = useState<
    "overview" | "job" | "standing" | "budget"
  >("overview");
  const [addReportLead, setAddReportLead] = useState<Agent | null>(null);

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

  const missionIdParam = searchParams.get("missionId");

  const writeParam = useCallback(
    (
      key: "missionId" | "q" | "status" | "seg",
      value: string | null,
    ) => {
      const next = new URLSearchParams(searchParams);
      if (key === "missionId") {
        if (!value || value === "all") next.delete("missionId");
        else next.set("missionId", value);
      } else if (key === "status") {
        if (!value || value === "all") next.delete("status");
        else next.set("status", value);
      } else if (key === "q") {
        if (!value) next.delete("q");
        else next.set("q", value);
      } else if (key === "seg") {
        if (!value || value === "active") next.delete("seg");
        else next.set("seg", value);
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
  ]);

  // Preserve tree building so we keep the existing model intact for tests.
  const tree = useMemo(
    () => buildOrgTree(filteredAgents, edges),
    [filteredAgents, edges],
  );
  // referenced to satisfy "preserve existing logic" — list rows are kept
  // for the test surface, not rendered directly here.
  const listRows = useMemo(() => buildListRows(tree), [tree]);
  void listRows;

  const teamGroups = useMemo(() => {
    const grouped = groupAgentsByTeam(filteredAgents, missions);
    return grouped.filter((g) => {
      if (segFilter === "all") return true;
      if (segFilter === "archived") return isArchivedMission(g.mission);
      return !isArchivedMission(g.mission);
    });
  }, [filteredAgents, missions, segFilter]);

  const activeAgentCount = filteredAgents.filter(
    (a) => a.status === "running" || a.status === "paused",
  ).length;
  const archivedTeams = useMemo(
    () =>
      groupAgentsByTeam(filteredAgents, missions).filter((g) =>
        isArchivedMission(g.mission),
      ).length,
    [filteredAgents, missions],
  );

  const missionSelectValue = scopeAllWorkspace
    ? "all"
    : (selectedMissionId ?? "all");

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
      <div className="af2-v2">
        <ErrorState title="Signal Lost" message={error} onRetry={refreshOrg} />
      </div>
    );
  }

  const pageMeta = `${activeAgentCount} active agent${activeAgentCount === 1 ? "" : "s"}${
    archivedTeams > 0
      ? ` · ${archivedTeams} archived team${archivedTeams === 1 ? "" : "s"}`
      : ""
  } · click a row to expand`;

  return (
    <div className="af2-v2">
      <div className="page-head">
        <div className="page-head-left">
          <div className="eyebrow">Workforce</div>
          <h1 className="h1">Team</h1>
          <div className="meta">{loading ? <SkeletonBlock lines={1} /> : pageMeta}</div>
        </div>
        <div className="page-head-right">
          <button type="button" className="btn">
            Manage teams
          </button>
          <Link to="/hire" className="btn primary">
            + Hire
          </Link>
        </div>
      </div>

      {agents.length > 0 ? (
        <div className="filterbar">
          <div className="seg">
            <button
              type="button"
              aria-selected={segFilter === "active"}
              onClick={() => writeParam("seg", "active")}
            >
              Active
            </button>
            <button
              type="button"
              aria-selected={segFilter === "archived"}
              onClick={() => writeParam("seg", "archived")}
            >
              Archived
            </button>
            <button
              type="button"
              aria-selected={segFilter === "all"}
              onClick={() => writeParam("seg", "all")}
            >
              All
            </button>
          </div>
          <input
            type="search"
            placeholder="Search agent or team…"
            value={searchQuery}
            onChange={(e) => writeParam("q", e.target.value)}
          />
          <select
            value={missionSelectValue}
            onChange={(e) =>
              writeParam(
                "missionId",
                e.target.value === "all" ? "all" : e.target.value,
              )
            }
            aria-label="Filter by team"
          >
            <option value="all">Any team</option>
            {missions.map((mission) => (
              <option key={mission.id} value={mission.id}>
                {truncateStatement(mission.statement)} · {mission.status}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => writeParam("status", e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">Any status</option>
            <option value="running">Active</option>
            <option value="idle">Idle</option>
            <option value="paused">Awaiting approval</option>
          </select>
          <div className="grow" />
        </div>
      ) : null}

      {agents.length === 0 && !loading ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <div style={{ maxWidth: 480, width: "100%" }}>
            <EmptyState
              title="No team yet"
              description="Define your first mission to start hiring."
              ctaLabel="+ Hire"
              ctaTo="/hire"
            />
          </div>
        </div>
      ) : null}

      {teamGroups.length === 0 && agents.length > 0 ? (
        <div className="card">
          <h3>No teams match</h3>
          <p className="desc">Try clearing the filters or hire a new team.</p>
        </div>
      ) : null}

      {teamGroups.map((group, groupIndex) => {
        const isArchived = isArchivedMission(group.mission);
        const status = isArchived ? "archived" : "live";
        const pillToneClass = isArchived ? "pill mustard dot" : "pill sage dot";
        const teamKey = teamStorageKey(group, groupIndex);
        const isCollapsed = collapsedTeams.has(teamKey);
        // Apply persisted intra-team ordering. Each team picks up its
        // own saved order on first render; subsequent drags update the
        // in-memory map (which agentOrderByTeam owns).
        const liveOrder =
          agentOrderByTeam[teamKey] ?? loadAgentOrder(activeWorkspaceId ?? null, teamKey);
        const orderedAgents = applyAgentOrder(group.agents, liveOrder);
        return (
          <div key={group.mission?.id ?? `unassigned-${groupIndex}`}>
            {/* Team header card */}
            <div
              className="card"
              style={{
                padding: "14px 18px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
                marginTop: groupIndex === 0 ? 0 : 14,
                cursor: "pointer",
              }}
              onClick={(e) => {
                // Don't toggle if the click came from one of the action
                // buttons in the header.
                if ((e.target as HTMLElement).closest("button")) return;
                toggleTeamCollapsed(teamKey);
              }}
              role="button"
              aria-expanded={!isCollapsed}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleTeamCollapsed(teamKey);
                }
              }}
            >
              <div>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    marginRight: 8,
                    color: "var(--af2-ink-3)",
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)",
                    transition: "transform 0.18s ease",
                  }}
                >
                  ▾
                </span>
                <b>{teamLabel(group)}</b>{" "}
                <span className={pillToneClass} style={{ marginLeft: 6 }}>
                  {status}
                </span>{" "}
                · {group.agents.length} agent{group.agents.length === 1 ? "" : "s"}
                {group.managerName ? (
                  <> · manager: {group.managerName}</>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    const firstLead = group.agents[0] ?? null;
                    if (firstLead) setAddReportLead(firstLead);
                    else
                      toast.error(
                        "No team lead yet — confirm a hiring plan before adding agents.",
                      );
                  }}
                >
                  Add agent
                </button>
                {!isArchived ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      toast.info(
                        "Archive team flow lives on the mission detail page.",
                      );
                    }}
                  >
                    Archive team
                  </button>
                ) : null}
                {group.mission ? (
                  <button
                    type="button"
                    className="btn danger sm"
                    onClick={() => setRetireTeamTarget(group.mission)}
                  >
                    Fire team
                  </button>
                ) : null}
              </div>
            </div>
            {/* Agent rows */}
            <div
              className="card card-list"
              style={{
                padding: 0,
                display: isCollapsed ? "none" : undefined,
              }}
            >
              {orderedAgents.map((agent) => {
                const isExpanded = openAgentId === agent.id;
                const snap = budgets.get(agent.id) ?? null;
                const spentLabel =
                  snap !== null
                    ? `$${snap.spentUsd.toFixed(0)}`
                    : agent.budgetMonthlyUsd > 0
                      ? "$0"
                      : "—";
                const budgetLabel =
                  snap !== null
                    ? `$${snap.monthlyUsd.toFixed(0)}`
                    : agent.budgetMonthlyUsd > 0
                      ? `$${agent.budgetMonthlyUsd.toFixed(0)}`
                      : "—";
                const tier = tierPillFor(agent);
                const label = primaryAgentLabel(agent);
                const isDragging = dragAgentId === agent.id;
                const isDropTarget =
                  dragOverAgentId === agent.id && dragAgentId !== agent.id;
                return (
                  <div
                    key={agent.id}
                    data-agent-row
                    data-agent-id={agent.id}
                    data-team-key={teamKey}
                  >
                    <div
                      className={`row${isExpanded ? " expanded" : ""}`}
                      style={{
                        gridTemplateColumns:
                          "26px 60px 1fr 130px 130px 100px 110px",
                        opacity: isDragging ? 0.4 : 1,
                        borderTop: isDropTarget
                          ? "2px solid var(--af2-clay)"
                          : undefined,
                        transition: "opacity 0.15s",
                      }}
                      onClick={() => {
                        if (isExpanded) {
                          setOpenAgentId(null);
                        } else {
                          setOpenAgentId(agent.id);
                          setAgentDrawerTab("overview");
                        }
                      }}
                      onDragOver={(e) => {
                        if (
                          e.dataTransfer.types.includes(
                            "application/x-autoflow-agent",
                          )
                        ) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragAgentId && dragAgentId !== agent.id) {
                            setDragOverAgentId(agent.id);
                          }
                        }
                      }}
                      onDrop={(e) => {
                        const sourceId = e.dataTransfer.getData(
                          "application/x-autoflow-agent",
                        );
                        const sourceTeam = e.dataTransfer.getData(
                          "application/x-autoflow-agent-team",
                        );
                        if (sourceId && sourceTeam === teamKey) {
                          e.preventDefault();
                          e.stopPropagation();
                          reorderAgentsInTeam(teamKey, sourceId, agent.id);
                        } else if (sourceId && sourceTeam !== teamKey) {
                          toast.info(
                            "Moving agents between teams needs backend support — currently scoped to in-team reordering.",
                          );
                        }
                        setDragAgentId(null);
                        setDragOverAgentId(null);
                      }}
                    >
                      <div
                        draggable
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData(
                            "application/x-autoflow-agent",
                            agent.id,
                          );
                          e.dataTransfer.setData(
                            "application/x-autoflow-agent-team",
                            teamKey,
                          );
                          setDragAgentId(agent.id);
                        }}
                        onDragEnd={() => {
                          setDragAgentId(null);
                          setDragOverAgentId(null);
                        }}
                        title="Drag to reorder within this team"
                        aria-label="Reorder agent"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "grab",
                          color: "var(--af2-ink-4)",
                          fontSize: 16,
                          userSelect: "none",
                          lineHeight: 1,
                        }}
                      >
                        ⋮⋮
                      </div>
                      <div
                        className="avatar"
                        style={{ width: 32, height: 32, fontSize: 12 }}
                      >
                        {initialsFor(label)}
                      </div>
                      <div>
                        <b>{label}</b>
                        <br />
                        <span
                          style={{
                            color: "var(--af2-ink-3)",
                            fontSize: 12,
                          }}
                        >
                          {agentSubtitle(agent)} · {agent.id.slice(0, 12)}
                        </span>
                      </div>
                      <div>
                        <span className="pill">{tier.label}</span>
                      </div>
                      <div>
                        <span className={presenceClass(presence.get(agent.id))}>
                          {presenceLabel(presence.get(agent.id))}
                        </span>
                      </div>
                      <div>
                        {spentLabel} / {budgetLabel}
                      </div>
                      <div className="actions">
                        <Link
                          to={`/agents/${encodeURIComponent(agent.id)}`}
                          className="btn sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                    <div
                      className={`row-drawer${isExpanded ? " open" : ""}`}
                    >
                      <div className="row-drawer-head">
                        <div>
                          <div
                            className="eyebrow"
                            style={{ marginBottom: 4 }}
                          >
                            Workforce · Agent
                          </div>
                          <h3>
                            {label} ·{" "}
                            <span
                              style={{
                                color: "var(--af2-ink-3)",
                                fontWeight: 400,
                              }}
                            >
                              {agentSubtitle(agent)}
                            </span>
                          </h3>
                        </div>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenAgentId(null);
                          }}
                        >
                          Collapse ↑
                        </button>
                      </div>
                      <div className="subtabs">
                        {(
                          [
                            { key: "overview", label: "Overview" },
                            { key: "job", label: "Job description" },
                            { key: "standing", label: "Standing tasks" },
                            { key: "budget", label: "Budget" },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            className="subtab"
                            aria-selected={agentDrawerTab === t.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAgentDrawerTab(t.key);
                            }}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {agentDrawerTab === "overview" ? (
                        <p style={{ fontSize: 13 }}>
                          Manager: {group.managerName ?? "—"} · Model:{" "}
                          {agent.model ?? "—"} · Budget: {spentLabel} /{" "}
                          {budgetLabel} this month · Status: {agent.status}
                        </p>
                      ) : agentDrawerTab === "job" ? (
                        <p style={{ fontSize: 13 }}>
                          Job description lives on the{" "}
                          <Link
                            to={`/agents/${encodeURIComponent(agent.id)}/job-description`}
                            className="link-clay"
                          >
                            Job page
                          </Link>
                          .
                        </p>
                      ) : agentDrawerTab === "standing" ? (
                        <p style={{ fontSize: 13 }}>
                          Standing tasks for this agent open on the{" "}
                          <Link
                            to={`/agents/${encodeURIComponent(agent.id)}/standing-tasks`}
                            className="link-clay"
                          >
                            Standing Tasks page
                          </Link>
                          .
                        </p>
                      ) : (
                        <p style={{ fontSize: 13 }}>
                          Budget / cap lives on the{" "}
                          <Link
                            to={`/budget?agentId=${encodeURIComponent(agent.id)}`}
                            className="link-clay"
                          >
                            Budget page
                          </Link>
                          .
                        </p>
                      )}
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <Link
                          to={`/agents/${encodeURIComponent(agent.id)}`}
                          className="btn"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open full detail →
                        </Link>
                        <button
                          type="button"
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toast.info(
                              "Reassign manager flow lives on the agent page.",
                            );
                          }}
                        >
                          Reassign manager
                        </button>
                        <button
                          type="button"
                          className="btn danger sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toast.info(
                              "Fire agent flow lives on the agent page.",
                            );
                          }}
                        >
                          Fire agent
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {addReportLead
        ? (() => {
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
          })()
        : null}

      {/* Fire team confirm modal */}
      {retireTeamTarget ? (
        <div
          className="af2-v2-modal-overlay"
          onClick={() => {
            if (!retiring) setRetireTeamTarget(null);
          }}
        >
          <div
            className="af2-v2-modal"
            role="dialog"
            aria-label="Fire team"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="af2-v2-modal-head">
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Workforce · Team
                </div>
                <h2>Fire this team?</h2>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setRetireTeamTarget(null)}
                disabled={retiring}
              >
                Esc · Close
              </button>
            </div>
            <div className="af2-v2-modal-body">
              <p style={{ fontSize: 13 }}>
                &ldquo;{truncateStatement(retireTeamTarget.statement, 140)}
                &rdquo; — this terminates every agent on the mission and clears
                org edges. You can re-hire later.
              </p>
            </div>
            <div className="af2-v2-modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setRetireTeamTarget(null)}
                disabled={retiring}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={retiring}
                onClick={async () => {
                  if (!retireTeamTarget) return;
                  setRetiring(true);
                  try {
                    const token = await requireAccessToken();
                    const result = await retireMissionTeam(
                      retireTeamTarget.id,
                      token,
                    );
                    toast.success(
                      `Team retired (${result.retiredAgentCount} agent${result.retiredAgentCount === 1 ? "" : "s"}).`,
                    );
                    setRetireTeamTarget(null);
                    refreshOrg();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Failed to retire team",
                    );
                  } finally {
                    setRetiring(false);
                  }
                }}
              >
                {retiring ? "Firing…" : "Fire team"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
