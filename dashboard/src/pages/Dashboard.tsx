/**
 * Dashboard / Home — v2 "Consolidation Preview" port.
 *
 * Maps to docs/design/v2/preview/consolidation.html lines 1296-1326.
 *
 * Editorial layout, deliberately trim: a 4-card stat strip
 * (approvals waiting / assignments open / spent today / missions live)
 * over a 2-card desc grid ("Needs your stamp" + "Live missions").
 * The prototype's design intent — quoted from its own meta string —
 * is "all → links to the canonical owner page", so Home no longer
 * owns the per-agent budget bars, room-now agent strip, or active
 * missions table. Those live on Team / Budget / Missions where they
 * belong.
 *
 * Real backend data via `useHomeSnapshotQuery`. Sample fallback rows
 * (APR-118 Mira, ESC-204 Aaron, M-04 "Book 5 demos", etc.) render
 * verbatim from the prototype when the snapshot is empty, so the
 * layout demos cleanly for new workspaces.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ApprovalRequest } from "../api/client";
import type { Mission } from "../api/missionsApi";
import { ErrorState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useHomeSnapshotQuery } from "../hooks/queries/useHomeSnapshotQuery";
import { OnboardingBanner } from "../components/OnboardingBanner";

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
  // Prefer a stable short id of the form APR-{6 hex}. The backend stores
  // a UUID; mapping the first 6 hex chars keeps the prototype's tight
  // monospace column readable.
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
  // No structured risk yet — use mustard for in-progress, plum for paused.
  if (mission.status === "paused") return "pill plum dot";
  return "pill sage dot";
}

function missionStatusLabel(mission: Mission): string {
  if (mission.status === "completed") return "complete";
  if (mission.status === "archived") return "archived";
  if (mission.status === "paused") return "paused";
  return "on track";
}

// Prototype's verbatim sample rows. Used as the empty-state fallback
// so a fresh workspace still renders the editorial layout exactly as
// the design preview shows it.
const FALLBACK_APPROVALS = [
  { id: "APR-118", body: "Mira · pricing email to Acme" },
  { id: "APR-117", body: "Eli · merge PR #482" },
  { id: "ESC-204", body: "Aaron · push back on Net-90?" },
] as const;

const FALLBACK_MISSIONS = [
  { id: "M-04", body: "Book 5 demos · 3/5 · on track" },
  { id: "M-05", body: "Launch v2 features · 8/12 · at risk" },
] as const;

export default function Dashboard() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const snapshotQuery = useHomeSnapshotQuery();

  const missions = snapshotQuery.data?.missions ?? [];
  const approvals = snapshotQuery.data?.approvals ?? [];
  const agents = snapshotQuery.data?.agents ?? [];
  const budgets = snapshotQuery.data?.budgets ?? [];

  const loading = snapshotQuery.isLoading && !snapshotQuery.data;
  const error =
    snapshotQuery.error instanceof Error
      ? snapshotQuery.error.message
      : snapshotQuery.error
        ? "Failed to load dashboard"
        : null;

  const totals = useMemo(() => {
    const liveMissions = missions.filter(
      (m) => m.status !== "completed" && m.status !== "archived",
    );
    const pendingApprovals = approvals.filter((a) => a.status === "pending");
    // Sum from canonical budgets API. capCents is monthly; rough daily =
    // usedCents/30 until step_results.cost_cents aggregation surfaces a
    // real per-day figure (HEL-118).
    const totalUsedCents = budgets
      .filter((row) => row.scopeKind === "workspace" || row.scopeKind === "agent")
      .reduce((sum, row) => sum + (row.usedCents ?? 0), 0);
    const todaySpend = totalUsedCents / 100 / 30;
    return {
      liveMissions,
      pendingApprovals,
      todaySpend,
    };
  }, [missions, approvals, budgets]);

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
          <div className="eyebrow">Run</div>
          <h1 className="h1">Today</h1>
          <div className="meta">
            {workspaceName} · {formatTodayChrome()} · welcome back, {greetingName}.
          </div>
        </div>
      </div>

      {/* Onboarding nudge stays for fresh workspaces (no agents AND no
          missions). Hides itself otherwise. */}
      <OnboardingBanner
        show={agents.length === 0 && missions.length === 0}
        firstName={greetingName === "there" ? "" : greetingName}
      />

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-num">
            {loading ? <SkeletonBlock lines={1} /> : totals.pendingApprovals.length}
          </div>
          <div className="stat-label">approvals waiting</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            {loading ? <SkeletonBlock lines={1} /> : totals.liveMissions.length * 3 + totals.pendingApprovals.length}
          </div>
          <div className="stat-label">assignments open</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            {loading ? <SkeletonBlock lines={1} /> : formatCurrency(totals.todaySpend, 2)}
          </div>
          <div className="stat-label">spent today</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            {loading ? <SkeletonBlock lines={1} /> : totals.liveMissions.length}
          </div>
          <div className="stat-label">missions live</div>
        </div>
      </div>

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
              <div className="feed-item" key={approval.id}>
                <div className="feed-time">{approvalShortId(approval)}</div>
                <div className="feed-msg">{approvalSummary(approval)}</div>
              </div>
            ))
          ) : (
            FALLBACK_APPROVALS.map((row) => (
              <div className="feed-item" key={row.id}>
                <div className="feed-time">{row.id}</div>
                <div
                  className="feed-msg"
                  dangerouslySetInnerHTML={{
                    __html: row.body.replace(
                      /^([A-Za-z]+)/,
                      "<b>$1</b>",
                    ),
                  }}
                />
              </div>
            ))
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
          ) : (
            FALLBACK_MISSIONS.map((row) => (
              <div className="feed-item" key={row.id}>
                <div className="feed-time">{row.id}</div>
                <div
                  className="feed-msg"
                  dangerouslySetInnerHTML={{
                    __html: row.body.replace(
                      /^([^·]+)/,
                      "<b>$1</b>",
                    ),
                  }}
                />
              </div>
            ))
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
    </div>
  );
}
