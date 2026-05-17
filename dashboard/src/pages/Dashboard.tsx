/**
 * Dashboard / Home — v2 editorial Home page.
 *
 * Matches `docs/design/v2/pages.jsx::AF2_Home`:
 *   - "Good {timeOfDay}, {firstName}." headline + sub-summary
 *   - 4-column stat strip (missions in flight / hours saved · 7d / spend ·
 *     month / approval p50)
 *   - Active missions table (left, ~62% width)
 *   - The room right now agent list (left, under the table)
 *   - Needs your stamp approval queue (right sidebar)
 *   - Spend by agent · this week bar list (right sidebar, bottom)
 *
 * The earlier non-v2 Dashboard (Execution Burndown / Spend vs Budget /
 * Queued Approvals / Artifact Review / Org Status panels) was structurally
 * the old "Customer command center" iteration. The full restructure replaces
 * it; the heavy observability streaming + ticket-routing flows were moved
 * to their canonical pages (Activity / Tickets) where they belong.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listApprovals, listRuns, type ApprovalRequest } from "../api/client";
import {
  getAgentHeartbeat,
  listAgents,
  type Agent,
  type AgentHeartbeat,
} from "../api/agentApi";
import { listBudgets, type BudgetRow } from "../api/canonicalApi";
import { listMissions, type Mission } from "../api/missionsApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { useAgentPresence } from "../hooks/useAgentPresence";
import type { WorkflowRun } from "../types/workflow";

interface AgentSnapshot {
  agent: Agent;
  budgetCents: number | null;
  capCents: number | null;
  heartbeat: AgentHeartbeat | null;
}

// Cap how many agents we fetch live heartbeats for. Beyond this, "The room
// right now" shows a compact summary instead of fanning out per-agent calls.
const ROOM_NOW_HEARTBEAT_LIMIT = 6;

function greetingPart(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function formatTodayChrome(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatCurrency(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function initialsFor(name: string | undefined | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function firstName(name: string | undefined | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] ?? "there";
}

function teamNameFor(agent: Agent): string | null {
  const raw = (agent.metadata as Record<string, unknown> | undefined)?.teamName;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function missionPillTone(mission: Mission): {
  className: string;
  label: string;
  progressColor: string;
} {
  switch (mission.status) {
    case "blocked":
      return {
        className: "af2-pill af2-pill-clay",
        label: "blocked",
        progressColor: "var(--af2-clay)",
      };
    case "review":
    case "awaiting_approval":
      return {
        className: "af2-pill af2-pill-pending",
        label: "review",
        progressColor: "var(--af2-mustard)",
      };
    case "scheduled":
    case "draft":
      return {
        className: "af2-pill",
        label: mission.status,
        progressColor: "var(--af2-ink-3)",
      };
    default:
      return {
        className: "af2-pill af2-pill-live",
        label: "in-flight",
        progressColor: "var(--af2-sage)",
      };
  }
}

function missionDueText(mission: Mission, latestRuns: WorkflowRun[]): string {
  // Without a dedicated due-date field on Mission, we fall back to inferring
  // urgency from the latest run state for the mission. If no run is linked,
  // show an em-dash.
  const latest = latestRuns.find((run) => run.input?.missionId === mission.id);
  if (!latest) return "—";
  if (latest.status === "failed") return "overdue";
  if (latest.status === "running") return "in flight";
  if (latest.status === "completed") return "done";
  return latest.status;
}

function approvalCostUsd(approval: ApprovalRequest): string {
  // ApprovalRequest doesn't currently carry a cost field. Display "—" so the
  // structure renders identically to the v2 reference; the real number wires
  // through once HEL-118's step_results rollup is consumed here.
  void approval;
  return "—";
}

export default function Dashboard() {
  const { user, requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  // Wave 2 live presence layer. Used to render an AgentPresencePill
  // next to each agent in "The room right now" so the home page shows
  // real-time "working: <task> · 12s" / "blocked" / "offline" state
  // instead of the lagging controlPlane heartbeat summary.
  const presence = useAgentPresence();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [agentSnapshots, setAgentSnapshots] = useState<AgentSnapshot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const accessToken = await requireAccessToken();

      // Bulk + parallel: 4 fixed calls instead of 4 + 2N fan-out. The
      // canonical /api/budgets returns one row per agent (and workspace) in
      // a single shot, so per-agent budget fetches are no longer required.
      const [agentList, approvalList, runList, budgetList, missionsList] =
        await Promise.all([
          listAgents(accessToken),
          listApprovals(accessToken),
          listRuns(undefined, accessToken),
          listBudgets(accessToken).catch(() => [] as BudgetRow[]),
          activeWorkspaceId
            ? listMissions(accessToken).catch(() => [] as Mission[])
            : Promise.resolve([] as Mission[]),
        ]);

      // Heartbeats are limited to the top-N agents we actually render in
      // "The room right now". Avoids a 50-agent dashboard burning the
      // 100-requests-per-minute generalApiRateLimiter on a single page load.
      const visibleAgents = agentList.slice(0, ROOM_NOW_HEARTBEAT_LIMIT);
      const heartbeats = await Promise.all(
        visibleAgents.map((agent) =>
          getAgentHeartbeat(agent.id, accessToken).catch(() => null),
        ),
      );
      const heartbeatById = new Map<string, AgentHeartbeat | null>(
        visibleAgents.map((agent, idx) => [agent.id, heartbeats[idx]]),
      );

      // Build snapshots from the bulk budget rows. Workspace-scope budget
      // rows are ignored here; we want per-agent caps for the spend strip.
      const budgetByAgent = new Map<string, BudgetRow>();
      for (const row of budgetList) {
        if (row.scopeKind === "agent" && row.scopeId) {
          budgetByAgent.set(row.scopeId, row);
        }
      }

      const snapshots: AgentSnapshot[] = agentList.map((agent) => {
        const budget = budgetByAgent.get(agent.id);
        return {
          agent,
          budgetCents: budget?.usedCents ?? null,
          capCents: budget?.capCents ?? null,
          heartbeat: heartbeatById.get(agent.id) ?? null,
        };
      });

      setMissions(missionsList);
      setAgentSnapshots(snapshots);
      setApprovals(approvalList);
      setRuns(runList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, requireAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const totals = useMemo(() => {
    const activeMissions = missions.filter(
      (m) => m.status !== "completed" && m.status !== "archived",
    );
    // Sum from agent.budgetMonthlyUsd (USD, on every agent row) so we don't
    // need a per-agent budget fetch to populate the strip. The canonical
    // /api/budgets cap (capCents) fills in the per-agent bars below.
    const totalSpendCents = agentSnapshots.reduce(
      (sum, snap) => sum + (snap.budgetCents ?? 0),
      0,
    );
    const totalCapCents = agentSnapshots.reduce(
      (sum, snap) => sum + (snap.capCents ?? Math.round((snap.agent.budgetMonthlyUsd ?? 0) * 100)),
      0,
    );
    const totalSpend = totalSpendCents / 100;
    const totalBudget = totalCapCents / 100;
    const liveAgents = agentSnapshots.filter(
      (snap) => snap.agent.status === "running" || snap.heartbeat?.status === "running",
    ).length;
    const pendingApprovals = approvals.filter((a) => a.status === "pending");
    // Approximate today's spend as 1/30 of monthly used until HEL-118's
    // step_results.cost_cents aggregation surfaces a real per-day figure.
    const todaySpend = totalSpend / 30;
    return {
      activeMissions,
      totalSpend,
      totalBudget,
      liveAgents,
      pendingApprovals,
      todaySpend,
    };
  }, [missions, agentSnapshots, approvals]);

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading home…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState
          title="Home unavailable"
          message={error}
          onRetry={() => void loadDashboard()}
        />
      </div>
    );
  }

  const spendPercent = totals.totalBudget > 0
    ? Math.round((totals.totalSpend / totals.totalBudget) * 100)
    : 0;

  return (
    <div className="af2-page bg-af2-paper text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">{formatTodayChrome()}</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Good {greetingPart()}, {firstName(user?.name)}.
          </h1>
          <div className="af2-page-head-meta">
            {totals.liveAgents} agents on the clock · {totals.pendingApprovals.length}{" "}
            approvals waiting · {formatCurrency(totals.todaySpend, 2)} spent today
          </div>
        </div>
        <div className="af2-page-actions">
          <Link to="/hire" className="af2-btn">
            Brief an agent
          </Link>
          <Link to="/hire" className="af2-btn af2-btn-clay">
            ＋ New mission
          </Link>
        </div>
      </div>

      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat">
          <div className="af2-stat-label">Missions in flight</div>
          <div className="af2-stat-value">{totals.activeMissions.length}</div>
          <div className="af2-stat-delta">
            {missions.length} total · {totals.activeMissions.length} active
          </div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Hours saved · 7d</div>
          <div className="af2-stat-value">—</div>
          <div className="af2-stat-delta">Tracking lands with HEL-118</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Spend · month</div>
          <div className="af2-stat-value">{formatCurrency(totals.totalSpend)}</div>
          <div className="af2-stat-delta">
            {totals.totalBudget > 0
              ? `${spendPercent}% of ${formatCurrency(totals.totalBudget)} cap`
              : "No budget set"}
          </div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Approval p50</div>
          <div className="af2-stat-value">—</div>
          <div className="af2-stat-delta">Median wired with approvals rollup</div>
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 22 }}
      >
        <section>
          <div className="af2-row" style={{ marginBottom: 10 }}>
            <h3 className="af2-h3">Active missions</h3>
            <span className="af2-spacer" />
            <Link to="/mission-state" className="af2-btn af2-btn-ghost af2-btn-sm">
              All missions →
            </Link>
          </div>
          {totals.activeMissions.length === 0 ? (
            <div className="af2-card" style={{ padding: 24, textAlign: "center" }}>
              <div className="af2-muted" style={{ fontSize: 13 }}>
                No active missions yet. <Link to="/hire" className="af2-btn af2-btn-ghost af2-btn-sm" style={{ display: "inline-flex", marginLeft: 8 }}>Start one →</Link>
              </div>
            </div>
          ) : (
            <div className="af2-list">
              <div
                className="af2-list-head"
                style={{ gridTemplateColumns: "1.7fr 130px 110px 90px 90px" }}
              >
                <div>Mission</div>
                <div>Owner</div>
                <div>Status</div>
                <div>Due</div>
                <div>Approvals</div>
              </div>
              {totals.activeMissions.slice(0, 8).map((mission) => {
                const tone = missionPillTone(mission);
                const due = missionDueText(mission, runs);
                const missionApprovals = approvals.filter(
                  (a) => a.status === "pending" && (a as { missionId?: string }).missionId === mission.id,
                );
                const owner = mission.companyName || "Workspace";
                return (
                  <Link
                    key={mission.id}
                    to={mission.latestHiringPlanId ? `/hire/plan/${mission.id}/${mission.latestHiringPlanId}` : `/mission-state`}
                    className="af2-list-row"
                    style={{
                      gridTemplateColumns: "1.7fr 130px 110px 90px 90px",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{mission.statement}</div>
                      <div
                        style={{
                          height: 4,
                          background: "var(--af2-paper-2)",
                          borderRadius: 4,
                          marginTop: 6,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${mission.status === "completed" ? 100 : 40}%`,
                            height: "100%",
                            background: tone.progressColor,
                          }}
                        />
                      </div>
                    </div>
                    <div className="af2-row">
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: "var(--af2-clay-soft)",
                          color: "var(--af2-clay-2)",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {initialsFor(owner)}
                      </div>
                      <span style={{ fontSize: 12.5 }}>{owner.split(" ")[0]}</span>
                    </div>
                    <div>
                      <span className={tone.className}>
                        <span className="af2-dot" />
                        {tone.label}
                      </span>
                    </div>
                    <div className="af2-mono" style={{ color: due === "overdue" ? "var(--af2-clay)" : "var(--af2-ink-3)" }}>
                      {due}
                    </div>
                    <div>
                      {missionApprovals.length > 0 ? (
                        <span className="af2-pill af2-pill-clay">{missionApprovals.length}</span>
                      ) : (
                        <span className="af2-muted-2">—</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
            The room right now
          </h3>
          <div className="af2-card" style={{ padding: 0 }}>
            {agentSnapshots.length === 0 ? (
              <div className="af2-muted" style={{ padding: 16, fontSize: 13, textAlign: "center" }}>
                No agents deployed yet. <Link to="/hire" style={{ color: "var(--af2-clay-2)" }}>Hire an agent →</Link>
              </div>
            ) : (
              agentSnapshots.slice(0, 6).map((snap, idx) => {
                const summary =
                  snap.heartbeat?.summary ??
                  (snap.agent.status === "idle" ? "Idle · awaiting next mission" : "Awaiting status…");
                const isWorking = snap.heartbeat?.status === "running" || snap.agent.status === "running";
                return (
                  <Link
                    key={snap.agent.id}
                    to={`/agents/team/${(snap.agent as Agent & { teamId?: string }).teamId ?? snap.agent.id}`}
                    className="af2-row"
                    style={{
                      padding: "12px 18px",
                      borderBottom:
                        idx === Math.min(agentSnapshots.length, 6) - 1 ? 0 : "1px solid var(--af2-line)",
                      gap: 14,
                      cursor: "pointer",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "var(--af2-clay-soft)",
                        color: "var(--af2-clay-2)",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {initialsFor(snap.agent.name)}
                    </div>
                    <div style={{ minWidth: 160 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {snap.agent.name}
                        <AgentPresencePill presence={presence.get(snap.agent.id)} />
                      </div>
                      <div className="af2-muted" style={{ fontSize: 12 }}>
                        {teamNameFor(snap.agent) ?? "Unassigned"}
                      </div>
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: "var(--af2-ink-2)" }}>
                      {/* Live presence pill above already shows the
                          current task / state. The summary fallback
                          here is the old controlPlane heartbeat
                          summary, kept for agents whose Redis TTL
                          lapsed (and so don't appear in `presence`). */}
                      {presence.has(snap.agent.id) ? null : isWorking ? (
                        <em className="font-af2-serif" style={{ color: "var(--af2-ink-2)" }}>
                          "{summary}"
                        </em>
                      ) : (
                        <span className="af2-muted">{summary}</span>
                      )}
                    </div>
                    <div className="af2-mono af2-muted" style={{ fontSize: 11.5 }}>
                      {(snap.agent as Agent & { model?: string }).model ?? "—"}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        <aside>
          <h3 className="af2-h3" style={{ marginBottom: 10 }}>
            Needs your stamp
          </h3>
          <div className="af2-card" style={{ padding: 0 }}>
            {totals.pendingApprovals.length === 0 ? (
              <div className="af2-muted" style={{ padding: 16, fontSize: 13, textAlign: "center" }}>
                Nothing waiting on you.
              </div>
            ) : (
              totals.pendingApprovals.slice(0, 4).map((approval, idx) => {
                const owningAgent = agentSnapshots.find((snap) =>
                  snap.heartbeat?.createdByRunId === approval.runId,
                );
                const ownerName = owningAgent?.agent.name ?? approval.assignee ?? "—";
                return (
                  <div
                    key={approval.id}
                    style={{
                      padding: "14px 16px",
                      borderBottom:
                        idx === Math.min(totals.pendingApprovals.length, 4) - 1
                          ? 0
                          : "1px solid var(--af2-line)",
                    }}
                  >
                    <div className="af2-row">
                      <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                        {approval.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="af2-spacer" />
                      <span className="af2-mono af2-muted" style={{ fontSize: 11 }}>
                        ● {approval.timeoutMinutes && approval.timeoutMinutes <= 30 ? "high" : "low"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.35 }}>
                      {approval.message ?? approval.stepName}
                    </div>
                    <div className="af2-row" style={{ marginTop: 10, gap: 8 }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: "var(--af2-clay-soft)",
                          color: "var(--af2-clay-2)",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {initialsFor(ownerName)}
                      </div>
                      <span className="af2-muted" style={{ fontSize: 12 }}>
                        {firstName(ownerName)} · {approvalCostUsd(approval)}
                      </span>
                      <span className="af2-spacer" />
                      <Link
                        to={`/approvals`}
                        className="af2-btn af2-btn-sm"
                      >
                        Open
                      </Link>
                      <Link
                        to={`/approvals`}
                        className="af2-btn af2-btn-sm af2-btn-primary"
                      >
                        Approve
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
            Spend by agent · this week
          </h3>
          <div className="af2-card">
            {agentSnapshots.length === 0 ? (
              <div className="af2-muted" style={{ fontSize: 13, textAlign: "center" }}>
                No agent spend recorded yet.
              </div>
            ) : (
              agentSnapshots.slice(0, 5).map((snap) => {
                const spent = (snap.budgetCents ?? 0) / 100;
                const budget =
                  (snap.capCents ?? Math.round((snap.agent.budgetMonthlyUsd ?? 0) * 100)) / 100;
                const pct = budget > 0 ? spent / budget : 0;
                const hot = pct > 0.8;
                return (
                  <div key={snap.agent.id} style={{ marginBottom: 12 }}>
                    <div className="af2-row" style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>{firstName(snap.agent.name)}</span>
                      <span className="af2-muted" style={{ marginLeft: 6 }}>
                        · {teamNameFor(snap.agent) ?? "Unassigned"}
                      </span>
                      <span className="af2-spacer" />
                      <span className="af2-mono">
                        {formatCurrency(spent)}{" "}
                        <span className="af2-muted-2">/ {formatCurrency(budget)}</span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "var(--af2-paper-2)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(pct * 100, 100)}%`,
                          height: "100%",
                          background: hot ? "var(--af2-clay)" : "var(--af2-ink-2)",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
