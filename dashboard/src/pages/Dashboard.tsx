/**
 * Dashboard / Home — v2 "Consolidation Preview" port + live extensions.
 *
 * Maps to docs/design/v2/preview/consolidation.html lines 1296-1326 plus
 * the second-wave interactivity work:
 *
 *  - Mission selector + "All" + persisted defaults via useHomeFilters.
 *  - Date range (Today / 7d / 30d / Custom) shared by the stat tiles,
 *    sparkline windows, and the bottom charts.
 *  - Live SSE subscription against /api/activity-events/stream so the
 *    page invalidates its snapshot in real time instead of polling. The
 *    react-query refetchInterval falls back to 60s if the stream is
 *    disconnected.
 *  - Inline ApprovalDrawer that resolves approvals without leaving the
 *    page and animates the affected agent "waking up" in a strip below
 *    the stat tiles.
 *  - Bottom-of-page charts (spend over time, agent activity, idle
 *    agents) so the page no longer trails off into white space.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ApprovalRequest } from "../api/client";
import type { Mission } from "../api/missionsApi";
import { ErrorState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useHomeSnapshotQuery } from "../hooks/queries/useHomeSnapshotQuery";
import { OnboardingBanner } from "../components/OnboardingBanner";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Sparkline } from "../components/Sparkline";
import { HomeFilterBar } from "../components/home/HomeFilterBar";
import {
  isWithinRange,
  useHomeFilters,
  type HomeFilters,
} from "../hooks/useHomeFilters";
import { useWorkspaceLiveStream } from "../hooks/useWorkspaceLiveStream";
import { ApprovalDrawer } from "../components/home/ApprovalDrawer";
import { AgentWakeStrip } from "../components/home/AgentWakeStrip";
import { SpendChart } from "../components/charts/SpendChart";
import { AgentActivityChart } from "../components/charts/AgentActivityChart";
import { IdleAgentsCallout } from "../components/home/IdleAgentsCallout";
import { queryKeys } from "../lib/queryKeys";

function formatTodayChrome(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatCurrency(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function firstName(name: string | undefined | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] ?? "there";
}

function approvalShortId(approval: ApprovalRequest): string {
  const id = approval.id ?? "";
  const short = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return short ? `APR-${short}` : "APR-—";
}

function approvalSummary(approval: ApprovalRequest): string {
  const assignee = approval.assignee?.trim() || "Agent";
  const message = approval.stepName || approval.message || "needs your stamp";
  return `${assignee} · ${message}`;
}

function missionShortId(mission: Mission): string {
  const id = mission.id ?? "";
  const short = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return short ? `M-${short}` : "M-—";
}

function missionToneClass(mission: Mission): string {
  if (mission.status === "completed") return "pill sage dot";
  if (mission.status === "archived") return "pill dot";
  if (mission.status === "paused") return "pill plum dot";
  return "pill sage dot";
}

function missionStatusLabel(mission: Mission): string {
  if (mission.status === "completed") return "complete";
  if (mission.status === "archived") return "archived";
  if (mission.status === "paused") return "paused";
  return "on track";
}

// Capacity of the in-memory history buffer that feeds the sparklines.
// At a 60s poll, 20 samples ≈ 20 minutes of trailing data.
const STAT_HISTORY_LIMIT = 20;

function useStatHistory(value: number): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const lastRef = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (lastRef.current === value) return;
    lastRef.current = value;
    setHistory((prev) => {
      const next = [...prev, value];
      if (next.length > STAT_HISTORY_LIMIT) next.shift();
      return next;
    });
  }, [value]);
  return history;
}

// Determine whether an approval belongs to a mission. Approvals don't
// carry missionId today; we fall back to the linked agent's metadata.
function approvalMissionId(
  approval: ApprovalRequest,
  agentMissionById: Map<string, string | null>,
): string | null {
  if (!approval.agentId) return null;
  return agentMissionById.get(approval.agentId) ?? null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const snapshotQuery = useHomeSnapshotQuery();

  const { filters, setMissionId, setRangePreset, setCustomRange } =
    useHomeFilters(activeWorkspaceId ?? null);

  const missions = snapshotQuery.data?.missions ?? [];
  const approvals = snapshotQuery.data?.approvals ?? [];
  const agents = snapshotQuery.data?.agents ?? [];
  const budgets = snapshotQuery.data?.budgets ?? [];
  const runs = snapshotQuery.data?.runs ?? [];
  const heartbeats = snapshotQuery.data?.heartbeats ?? {};

  const loading = snapshotQuery.isLoading && !snapshotQuery.data;
  const error =
    snapshotQuery.error instanceof Error
      ? snapshotQuery.error.message
      : snapshotQuery.error
        ? "Failed to load dashboard"
        : null;

  // --- Live stream wiring ---------------------------------------------------
  //
  // Subscribe to the workspace activity SSE; on any non-heartbeat event,
  // invalidate the home snapshot so the tiles + lists refresh against
  // the latest state. The polling interval in the query hook stays in
  // place as a safety net for when the stream is disconnected.
  const liveStream = useWorkspaceLiveStream({
    path: "activity-events/stream",
    enabled: !!activeWorkspaceId,
    onEvent: (evt) => {
      if (evt.name === "heartbeat") return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.home(activeWorkspaceId ?? "none"),
      });
    },
  });
  const isLive = liveStream.state === "connected";

  // Map each agent to its mission so we can filter approvals + spend
  // by the selected mission. The agent.metadata.missionId convention
  // is the same one OrgStructure uses.
  const agentMissionById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const a of agents) {
      const raw = a.metadata?.missionId;
      map.set(a.id, typeof raw === "string" && raw.length > 0 ? raw : null);
    }
    return map;
  }, [agents]);

  // --- Filtered slices ------------------------------------------------------
  const filteredApprovals = useMemo(() => {
    return approvals.filter((a) => {
      if (filters.missionId) {
        const mid = approvalMissionId(a, agentMissionById);
        if (mid !== filters.missionId) return false;
      }
      if (a.requestedAt && !isWithinRange(a.requestedAt, filters.range)) {
        return false;
      }
      return true;
    });
  }, [approvals, filters, agentMissionById]);

  const filteredMissions = useMemo(() => {
    if (!filters.missionId) return missions;
    return missions.filter((m) => m.id === filters.missionId);
  }, [missions, filters.missionId]);

  const filteredAgents = useMemo(() => {
    if (!filters.missionId) return agents;
    return agents.filter(
      (a) => agentMissionById.get(a.id) === filters.missionId,
    );
  }, [agents, filters.missionId, agentMissionById]);

  const totals = useMemo(() => {
    const liveMissions = filteredMissions.filter(
      (m) => m.status !== "completed" && m.status !== "archived",
    );
    const pendingApprovals = filteredApprovals.filter(
      (a) => a.status === "pending",
    );
    // Per-agent spend for the filtered scope.
    const agentIds = new Set(filteredAgents.map((a) => a.id));
    const totalUsedCents = budgets.reduce((sum, row) => {
      if (row.scopeKind === "agent" && row.scopeId && agentIds.size > 0) {
        return agentIds.has(row.scopeId) ? sum + (row.usedCents ?? 0) : sum;
      }
      if (
        row.scopeKind === "workspace" &&
        !filters.missionId &&
        agentIds.size === 0
      ) {
        // Only count workspace-scope spend when nothing is filtered.
        return sum + (row.usedCents ?? 0);
      }
      return sum;
    }, 0);
    // Daily approximation = monthly used / 30 until a real per-day
    // figure surfaces from step_results (HEL-118).
    const rangedSpend = totalUsedCents / 100 / 30;
    return { liveMissions, pendingApprovals, rangedSpend };
  }, [filteredMissions, filteredApprovals, filteredAgents, budgets, filters.missionId]);

  const approvalsHistory = useStatHistory(totals.pendingApprovals.length);
  const assignmentsHistory = useStatHistory(
    totals.liveMissions.length * 3 + totals.pendingApprovals.length,
  );
  const spendHistory = useStatHistory(totals.rangedSpend);
  const missionsHistory = useStatHistory(totals.liveMissions.length);

  const isRefreshing =
    snapshotQuery.isFetching && !snapshotQuery.isLoading && !isLive;

  // --- Approval drawer + wake animation ------------------------------------
  const [openApprovalId, setOpenApprovalId] = useState<string | null>(null);
  const openApproval = useMemo(
    () => approvals.find((a) => a.id === openApprovalId) ?? null,
    [approvals, openApprovalId],
  );
  const [recentlyWoken, setRecentlyWoken] = useState<
    Array<{ agentId: string | null; agentName: string; startedAt: number }>
  >([]);

  const handleApprovalResolved = useCallback(
    (approval: ApprovalRequest, decision: "approved" | "rejected") => {
      if (decision === "approved") {
        setRecentlyWoken((prev) => [
          {
            agentId: approval.agentId ?? null,
            agentName: approval.assignee?.trim() || "Agent",
            startedAt: Date.now(),
          },
          ...prev.filter((row) => row.agentId !== approval.agentId),
        ].slice(0, 4));
      }
      setOpenApprovalId(null);
      // Force an immediate refetch so the stat tiles + lists update
      // before the SSE invalidation lands.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.home(activeWorkspaceId ?? "none"),
      });
    },
    [queryClient, activeWorkspaceId],
  );

  if (error && !snapshotQuery.data) {
    return (
      <div className="af2-v2">
        <ErrorState
          title="Home unavailable"
          message={error}
          onRetry={() => void snapshotQuery.refetch()}
        />
      </div>
    );
  }

  const workspaceName = activeWorkspace?.name?.trim() || "Your workspace";
  const greetingName = firstName(user?.name);

  const topApprovals = totals.pendingApprovals.slice(0, 3);
  const topMissions = totals.liveMissions.slice(0, 2);

  return (
    <div className="af2-v2">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="h1">Today</h1>
          <div className="meta">
            {workspaceName} · {formatTodayChrome()} · welcome back, {greetingName}.
          </div>
        </div>
      </div>

      <OnboardingBanner
        show={agents.length === 0 && missions.length === 0}
        firstName={greetingName === "there" ? "" : greetingName}
      />

      <HomeFilterBar
        missions={missions}
        missionId={filters.missionId}
        range={filters.range}
        onMissionChange={setMissionId}
        onRangePreset={setRangePreset}
        onCustomRange={setCustomRange}
      />

      <LiveConnectionIndicator
        state={liveStream.state}
        isRefreshing={isRefreshing}
        lastEventAt={liveStream.lastEventAt}
      />

      <div className="stat-grid">
        <StatTile
          label="approvals waiting"
          value={totals.pendingApprovals.length}
          history={approvalsHistory}
          loading={loading}
        />
        <StatTile
          label="assignments open"
          value={totals.liveMissions.length * 3 + totals.pendingApprovals.length}
          history={assignmentsHistory}
          loading={loading}
        />
        <StatTile
          label="spent in range"
          value={totals.rangedSpend}
          history={spendHistory}
          loading={loading}
          format={(v) => formatCurrency(v, 2)}
        />
        <StatTile
          label="missions live"
          value={totals.liveMissions.length}
          history={missionsHistory}
          loading={loading}
        />
      </div>

      <AgentWakeStrip entries={recentlyWoken} />

      <div className="desc-grid">
        <div className="card">
          <h3>Needs your stamp</h3>
          <p className="desc">
            Top 3 ·{" "}
            <Link to="/approvals" className="link-clay">
              all approvals →
            </Link>
          </p>
          {topApprovals.length > 0 ? (
            topApprovals.map((approval) => (
              <button
                key={approval.id}
                type="button"
                onClick={() => setOpenApprovalId(approval.id)}
                className="feed-item"
                style={{
                  display: "flex",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 4px",
                  borderRadius: 6,
                  alignItems: "baseline",
                  gap: 12,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--af2-paper-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div className="feed-time">{approvalShortId(approval)}</div>
                <div className="feed-msg" style={{ flex: 1 }}>
                  {approvalSummary(approval)}
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--af2-clay)",
                    fontWeight: 500,
                  }}
                >
                  review →
                </span>
              </button>
            ))
          ) : approvals.length > 0 ? (
            <p
              className="desc"
              style={{ fontSize: 12, color: "var(--af2-ink-3)" }}
            >
              No approvals match the current filters.
            </p>
          ) : (
            <div
              className="desc"
              style={{ padding: "12px 0", color: "var(--af2-ink-3)", fontStyle: "italic" }}
            >
              Nothing waiting. Agents will queue items here when they need a stamp.
            </div>
          )}
        </div>

        <div className="card">
          <h3>Live missions</h3>
          {topMissions.length > 0 ? (
            <>
              {topMissions.map((mission) => (
                <div className="feed-item" key={mission.id}>
                  <div className="feed-time">{missionShortId(mission)}</div>
                  <div className="feed-msg">
                    <b>{mission.statement?.slice(0, 60) || "Untitled mission"}</b>
                    {" · "}
                    <span className={missionToneClass(mission)}>
                      {missionStatusLabel(mission)}
                    </span>
                  </div>
                </div>
              ))}
            </>
          ) : missions.length > 0 ? (
            <p
              className="desc"
              style={{ fontSize: 12, color: "var(--af2-ink-3)" }}
            >
              No missions match the current filters.
            </p>
          ) : (
            <div
              className="desc"
              style={{ padding: "12px 0", color: "var(--af2-ink-3)", fontStyle: "italic" }}
            >
              No live missions yet. <Link to="/hire" className="link-clay">Brief one →</Link>
            </div>
          )}
          <Link
            to="/mission-state"
            className="link-clay"
            style={{ fontSize: 12, marginTop: 8, display: "inline-block" }}
          >
            all missions →
          </Link>
        </div>
      </div>

      {/* Bottom-of-page charts — fill the space the v2 layout left
          deliberately empty. Each chart respects the current
          mission + date-range filters. */}
      <HomeAnalytics
        filters={filters}
        agents={filteredAgents}
        budgets={budgets}
        runs={runs}
        heartbeats={heartbeats}
      />

      <ApprovalDrawer
        approval={openApproval}
        onClose={() => setOpenApprovalId(null)}
        onResolved={handleApprovalResolved}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  history,
  loading,
  format,
}: {
  label: string;
  value: number;
  history: number[];
  loading: boolean;
  format?: (value: number) => string;
}) {
  const showSpark = history.length >= 2;
  return (
    <div className="stat-card" style={{ position: "relative" }}>
      <div className="stat-num">
        {loading ? (
          <SkeletonBlock lines={1} />
        ) : (
          <AnimatedNumber value={value} format={format} />
        )}
      </div>
      <div className="stat-label">{label}</div>
      {showSpark ? (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 10,
            opacity: 0.85,
            pointerEvents: "none",
          }}
        >
          <Sparkline
            values={history}
            width={72}
            height={20}
            label={`${label} trend`}
          />
        </div>
      ) : null}
    </div>
  );
}

function LiveConnectionIndicator({
  state,
  isRefreshing,
  lastEventAt,
}: {
  state: ReturnType<typeof useWorkspaceLiveStream>["state"];
  isRefreshing: boolean;
  lastEventAt: number | null;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    // Re-render every 10s so the "last update Ns ago" label stays fresh.
    const id = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const connected = state === "connected";
  const dotColor = connected
    ? "var(--af2-sage, #6b9e5e)"
    : state === "error" || state === "reconnecting"
      ? "var(--af2-clay, #c25b3a)"
      : "var(--af2-ink-4)";
  const animate = !connected || isRefreshing;
  const label = (() => {
    if (connected) {
      if (lastEventAt) {
        const diff = Date.now() - lastEventAt;
        if (diff < 5_000) return "Live · update just now";
        if (diff < 60_000)
          return `Live · last update ${Math.round(diff / 1000)}s ago`;
        return `Live · last update ${Math.round(diff / 60_000)}m ago`;
      }
      return "Live · waiting for activity";
    }
    if (state === "connecting") return "Connecting to live stream…";
    if (state === "reconnecting") return "Reconnecting…";
    if (state === "error") return "Stream offline · polling fallback";
    return "Polling fallback";
  })();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "0 0 8px",
        fontSize: 11,
        color: "var(--af2-ink-3)",
      }}
    >
      <span
        aria-label={connected ? "Live" : label}
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          animation: animate ? "af2-pulse 1.2s ease-out infinite" : "none",
        }}
      />
      <span>{label}</span>
    </div>
  );
}

interface HomeAnalyticsProps {
  filters: HomeFilters;
  agents: ReturnType<typeof useHomeSnapshotQuery>["data"] extends infer T
    ? T extends { agents: infer A }
      ? A
      : never
    : never;
  budgets: ReturnType<typeof useHomeSnapshotQuery>["data"] extends infer T
    ? T extends { budgets: infer B }
      ? B
      : never
    : never;
  runs: ReturnType<typeof useHomeSnapshotQuery>["data"] extends infer T
    ? T extends { runs: infer R }
      ? R
      : never
    : never;
  heartbeats: ReturnType<typeof useHomeSnapshotQuery>["data"] extends infer T
    ? T extends { heartbeats: infer H }
      ? H
      : never
    : never;
}

function HomeAnalytics({ filters, agents, budgets, runs, heartbeats }: HomeAnalyticsProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: 0 }}>Spend in range</h3>
          <p className="desc" style={{ marginTop: 4 }}>
            Cumulative spend across the selected window.
          </p>
          <SpendChart
            range={filters.range}
            budgets={budgets}
            runs={runs}
            scopedAgentIds={
              filters.missionId
                ? new Set(agents.map((a) => a.id))
                : undefined
            }
          />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: 0 }}>Who's working</h3>
          <p className="desc" style={{ marginTop: 4 }}>
            Agent presence distribution.
          </p>
          <AgentActivityChart agents={agents} heartbeats={heartbeats} />
        </div>
      </div>
      <IdleAgentsCallout agents={agents} heartbeats={heartbeats} />
    </div>
  );
}
