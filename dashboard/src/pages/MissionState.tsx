/**
 * Missions page (HEL-32 v2 rebuild → HEL-210 PR F refresh).
 *
 * HEL-210 changes:
 *   - Top filter bar replaces the count-tab strip with a segmented
 *     control `Live · Archived · All`, bound to the `?status=` query
 *     param so the filter is shareable / back-navigable.
 *   - Clicking a mission row opens an inline `Af2RowDrawer` with
 *     sub-tabs `Statement · Team · Assignments`. The Team / Assignments
 *     panes are scaffold-level — TODO until the sub-list APIs land.
 *   - Each row exposes two action buttons: Complete (sage) and Stop
 *     (clay), which open `CompleteMissionModal` / `StopMissionModal`.
 *
 * The original "Discard" affordance lives inside the drawer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, OctagonX, Trash2 } from "lucide-react";
import { deleteMission, type Mission } from "../api/missionsApi";
import { Af2RowDrawer } from "../components/Af2RowDrawer";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";
import { CompleteMissionModal } from "../components/missions/CompleteMissionModal";
import { StopMissionModal } from "../components/missions/StopMissionModal";
import { missionLinkTo } from "../lib/missionNavigation";
import { useToast } from "../components/ToastProvider";
import { ErrorState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";

type StatusFilter = "live" | "archived" | "all";
type DrawerTab = "statement" | "team" | "assignments";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

function parseStatusFilter(value: string | null): StatusFilter {
  if (value === "archived" || value === "all") return value;
  return "live";
}

function isArchived(status: string): boolean {
  return status === "archived" || status === "completed" || status === "stopped";
}

function matchesStatusFilter(mission: Mission, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "archived") return isArchived(mission.status);
  return !isArchived(mission.status);
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function progressFor(status: string): number {
  switch (status) {
    case "completed":
    case "archived":
    case "stopped":
      return 1;
    case "review":
    case "awaiting_approval":
      return 0.75;
    case "in_flight":
    case "active":
    case "running":
      return 0.5;
    case "blocked":
      return 0.4;
    case "scheduled":
    case "draft":
      return 0.1;
    default:
      return 0.1;
  }
}

function pillFor(status: string): { className: string; label: string } {
  if (status === "blocked") return { className: "af2-pill af2-pill-clay", label: "blocked" };
  if (status === "review" || status === "awaiting_approval")
    return { className: "af2-pill af2-pill-pending", label: "review" };
  if (status === "scheduled" || status === "draft")
    return { className: "af2-pill", label: status };
  if (status === "completed") return { className: "af2-pill", label: "done" };
  if (status === "archived") return { className: "af2-pill", label: "archived" };
  if (status === "stopped") return { className: "af2-pill af2-pill-clay", label: "stopped" };
  return { className: "af2-pill af2-pill-live", label: "in flight" };
}

function progressColor(status: string): string {
  if (status === "blocked" || status === "stopped") return "var(--af2-clay)";
  return "var(--af2-sage)";
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function dueText(mission: Mission): string {
  return mission.metadata?.runway?.trim() || "—";
}

function successMetricText(mission: Mission): string {
  return mission.metadata?.successMetric?.trim() || "—";
}

function ownerFor(mission: Mission): { display: string; sub: string } {
  const company = mission.companyName?.trim() || "Workspace";
  const first = company.split(/\s+/)[0] ?? company;
  return { display: company, sub: `Owner · ${first}` };
}

export default function MissionState() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const highlightMissionId = searchParams.get("mission");
  const statusFilter = parseStatusFilter(searchParams.get("status"));

  const queryClient = useQueryClient();
  const missionsQuery = useMissionsQuery();
  const missions = missionsQuery.data ?? [];
  const loading = missionsQuery.isLoading && !missionsQuery.data;
  const error =
    missionsQuery.error instanceof Error ? missionsQuery.error.message : null;

  const [openDrawerId, setOpenDrawerId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("statement");
  const [discardTarget, setDiscardTarget] = useState<Mission | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<Mission | null>(null);
  const [stopTarget, setStopTarget] = useState<Mission | null>(null);
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.title = "Missions | AutoFlow";
  }, []);

  useEffect(() => {
    if (!highlightMissionId || loading) return;
    const match = missions.find((m) => m.id === highlightMissionId);
    if (match && missionLinkTo(match).startsWith("/missions/")) {
      navigate(missionLinkTo(match), { replace: true });
      return;
    }
    highlightedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightMissionId, loading, missions, navigate]);

  const setStatusFilterParam = (next: StatusFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next === "live") params.delete("status");
    else params.set("status", next);
    setSearchParams(params, { replace: true });
  };

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { live: 0, archived: 0, all: 0 };
    result.all = missions.length;
    for (const m of missions) {
      if (isArchived(m.status)) result.archived += 1;
      else result.live += 1;
    }
    return result;
  }, [missions]);

  const visibleMissions = useMemo(
    () => missions.filter((m) => matchesStatusFilter(m, statusFilter)),
    [missions, statusFilter],
  );

  const refreshAfterMutation = async () => {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.missions(activeWorkspaceId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.home(activeWorkspaceId),
    });
  };

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Missions</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Missions
          </h1>
          <div className="af2-page-head-meta">
            Briefs you give your team. Each becomes a plan, a budget, and a
            paper trail.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/routines"
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            Routines
          </Link>
          <Link to="/hire" className="af2-btn af2-btn-clay" style={{ textDecoration: "none" }}>
            ＋ New mission
          </Link>
        </div>
      </div>

      {/* HEL-210 segmented filter bar */}
      <div
        className="af2-tabs"
        role="tablist"
        aria-label="Mission status filter"
        style={{ marginBottom: 14 }}
      >
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={statusFilter === f.key}
            className={`af2-tab${statusFilter === f.key ? " active" : ""}`}
            onClick={() => setStatusFilterParam(f.key)}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="af2-card" style={{ padding: 24 }}>
          <SkeletonBlock lines={3} />
        </div>
      ) : error ? (
        <ErrorState
          title="Missions unavailable"
          message={error}
          onRetry={() => void missionsQuery.refetch()}
        />
      ) : visibleMissions.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 16, color: "var(--af2-ink)", margin: 0 }}
          >
            No missions in this view yet.
          </p>
          <p className="af2-muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            A mission is what your team is trying to accomplish. Brief one,
            and we'll draft the team to run it.
          </p>
          <Link
            to="/hire"
            className="af2-btn af2-btn-clay"
            style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            Brief a new mission →
          </Link>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 16,
          }}
        >
          {visibleMissions.map((mission) => {
            const pill = pillFor(mission.status);
            const owner = ownerFor(mission);
            const progress = progressFor(mission.status);
            const color = progressColor(mission.status);
            const highlighted = highlightMissionId === mission.id;
            const isOpen = openDrawerId === mission.id;
            const archived = isArchived(mission.status);
            return (
              <div
                key={mission.id}
                ref={highlighted ? highlightedRef : undefined}
                className="af2-card"
                style={{
                  padding: 0,
                  display: "block",
                  outline: highlighted ? "2px solid var(--af2-sage)" : undefined,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isOpen) setOpenDrawerId(null);
                    else {
                      setOpenDrawerId(mission.id);
                      setDrawerTab("statement");
                    }
                  }}
                  aria-expanded={isOpen}
                  aria-controls={`mission-drawer-${mission.id}`}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: 0,
                    textAlign: "left",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 20,
                    display: "block",
                  }}
                >
                  <div className="af2-row">
                    <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                      {shortId(mission.id)}
                    </span>
                    <span className="af2-spacer" />
                    <span className={pill.className}>
                      <span className="af2-dot" />
                      {pill.label}
                    </span>
                  </div>
                  <div className="af2-h3" style={{ marginTop: 8, fontSize: 18 }}>
                    {mission.statement}
                  </div>
                  <div
                    className="af2-muted"
                    style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}
                  >
                    Success metric · {successMetricText(mission)}
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: "var(--af2-paper-2)",
                      borderRadius: 4,
                      marginTop: 14,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{ width: `${progress * 100}%`, height: "100%", background: color }}
                    />
                  </div>
                  <div className="af2-row" style={{ marginTop: 14 }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "var(--af2-clay-soft)",
                        color: "var(--af2-clay-2)",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {initialsFor(owner.display)}
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{owner.display}</span>
                    <span className="af2-muted" style={{ fontSize: 12 }}>
                      · {owner.sub}
                    </span>
                    <span className="af2-spacer" />
                    <span className="af2-mono af2-muted" style={{ fontSize: 11.5 }}>
                      {dueText(mission)}
                    </span>
                  </div>
                </button>

                {/* HEL-210 row actions: Complete (sage) + Stop (clay).
                    Live-only — archived rows hide them. */}
                {!archived ? (
                  <div
                    className="af2-row"
                    style={{ padding: "0 20px 14px", gap: 8, justifyContent: "flex-end" }}
                  >
                    <button
                      type="button"
                      className="af2-btn af2-btn-ghost af2-btn-sm"
                      style={{ color: "var(--af2-sage)" }}
                      aria-label="Complete mission"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCompleteTarget(mission);
                      }}
                    >
                      <CheckCircle2 size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
                      Complete
                    </button>
                    <button
                      type="button"
                      className="af2-btn af2-btn-ghost af2-btn-sm"
                      style={{ color: "var(--af2-clay)" }}
                      aria-label="Stop mission"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStopTarget(mission);
                      }}
                    >
                      <OctagonX size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
                      Stop
                    </button>
                  </div>
                ) : null}

                <Af2RowDrawer
                  open={isOpen}
                  onClose={() => setOpenDrawerId(null)}
                  ariaLabel={`Mission ${shortId(mission.id)} details`}
                >
                  <div
                    id={`mission-drawer-${mission.id}`}
                    style={{ padding: "14px 20px 18px" }}
                  >
                    <div
                      className="af2-tabs"
                      role="tablist"
                      aria-label="Mission details"
                      style={{ marginBottom: 12 }}
                    >
                      {(
                        [
                          { key: "statement", label: "Statement" },
                          { key: "team", label: "Team" },
                          { key: "assignments", label: "Assignments" },
                        ] as Array<{ key: DrawerTab; label: string }>
                      ).map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          role="tab"
                          aria-selected={drawerTab === t.key}
                          className={`af2-tab${drawerTab === t.key ? " active" : ""}`}
                          onClick={() => setDrawerTab(t.key)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {drawerTab === "statement" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                          {mission.statement}
                        </p>
                        <div className="af2-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                          Success metric · {successMetricText(mission)}
                          <br />
                          Runway · {dueText(mission)}
                          <br />
                          Company · {mission.companyName}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Link
                            to={missionLinkTo(mission)}
                            className="af2-btn af2-btn-sm"
                            style={{ textDecoration: "none" }}
                          >
                            Open full detail →
                          </Link>
                          <button
                            type="button"
                            className="af2-btn af2-btn-ghost af2-btn-sm"
                            style={{ color: "var(--af2-clay)", marginLeft: 8 }}
                            onClick={() => setDiscardTarget(mission)}
                          >
                            <Trash2 size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
                            Discard
                          </button>
                        </div>
                      </div>
                    ) : drawerTab === "team" ? (
                      // TODO(HEL-210 follow-up): wire to /api/missions/:id/team
                      <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                        Team breakdown lives on the{" "}
                        <Link
                          to={`/workspace/org-structure?missionId=${encodeURIComponent(mission.id)}`}
                          style={{ color: "var(--af2-sage)" }}
                        >
                          Team page
                        </Link>{" "}
                        — scoped to this mission.
                      </div>
                    ) : (
                      // TODO(HEL-210 follow-up): assignments roll-up.
                      <div className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                        Per-agent assignments for this mission roll up here
                        once the run log filter ships.
                      </div>
                    )}
                  </div>
                </Af2RowDrawer>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDestructiveModal
        open={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        eyebrow="Discard mission"
        title="Discard this mission?"
        message={
          discardTarget
            ? `"${discardTarget.statement.slice(0, 140)}${
                discardTarget.statement.length > 140 ? "…" : ""
              }"\n\nAny draft hiring plan will also be deleted. This can't be undone.`
            : ""
        }
        confirmLabel="Discard mission"
        confirming={discarding}
        onConfirm={async () => {
          if (!discardTarget) return;
          setDiscarding(true);
          try {
            const token = await requireAccessToken();
            await deleteMission(discardTarget.id, token);
            toast.success("Mission discarded.");
            setDiscardTarget(null);
            await refreshAfterMutation();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to discard mission");
          } finally {
            setDiscarding(false);
          }
        }}
      />

      {completeTarget ? (
        <CompleteMissionModal
          open
          onClose={() => setCompleteTarget(null)}
          missionId={completeTarget.id}
          missionStatement={completeTarget.statement}
          onCompleted={() => void refreshAfterMutation()}
        />
      ) : null}

      {stopTarget ? (
        <StopMissionModal
          open
          onClose={() => setStopTarget(null)}
          missionId={stopTarget.id}
          missionStatement={stopTarget.statement}
          onStopped={() => void refreshAfterMutation()}
        />
      ) : null}
    </div>
  );
}
