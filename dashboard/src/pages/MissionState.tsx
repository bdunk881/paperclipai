/**
 * Missions page (HEL-32 v2 rebuild).
 *
 * Mirrors the v2 reference (`docs/design/v2/pages.jsx::AF2_Missions`):
 *   - af2-page chrome with eyebrow + serif h1 + meta
 *   - Templates / +New mission action buttons
 *   - Status tab strip ("In flight (N)" / "Review (N)" / "Scheduled (N)" /
 *     "Done (N)" / "All") with live counters from the missions list
 *   - 2-column card grid: ID, status pill, statement, success metric,
 *     progress bar, owner avatar + due
 *
 * Data: `listMissions` from `../api/missionsApi`. Gated on `activeWorkspaceId`
 * so the call doesn't fire before a workspace exists. Each card links to the
 * hiring-plan review page if the mission has a `latestHiringPlanId`, else
 * falls back to `/hire`.
 *
 * Previously this page was a single-mission "Mission State" view backed by
 * the `/api/control-plane/teams/:id/mission-state` contract. That contract +
 * the loader-driven route are removed here; the route now renders straight
 * from the workspace missions list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listMissions, type Mission } from "../api/missionsApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

type TabKey = "in_flight" | "review" | "scheduled" | "done" | "all";

interface TabDef {
  key: TabKey;
  label: string;
  match: (mission: Mission) => boolean;
}

const TABS: TabDef[] = [
  {
    key: "in_flight",
    label: "In flight",
    match: (m) =>
      m.status === "in_flight" ||
      m.status === "blocked" ||
      m.status === "running",
  },
  {
    key: "review",
    label: "Review",
    match: (m) => m.status === "review" || m.status === "awaiting_approval",
  },
  {
    key: "scheduled",
    label: "Scheduled",
    match: (m) => m.status === "scheduled" || m.status === "draft",
  },
  {
    key: "done",
    label: "Done",
    match: (m) => m.status === "completed" || m.status === "archived",
  },
  { key: "all", label: "All", match: () => true },
];

function initialsFor(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function progressFor(status: string): number {
  switch (status) {
    case "completed":
    case "archived":
      return 1;
    case "review":
    case "awaiting_approval":
      return 0.75;
    case "in_flight":
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
  if (status === "blocked") {
    return { className: "af2-pill af2-pill-clay", label: "blocked" };
  }
  if (status === "review" || status === "awaiting_approval") {
    return { className: "af2-pill af2-pill-pending", label: "review" };
  }
  if (status === "scheduled" || status === "draft") {
    return { className: "af2-pill", label: status };
  }
  if (status === "completed" || status === "archived") {
    return { className: "af2-pill", label: "done" };
  }
  // default: in_flight / running / unknown
  return { className: "af2-pill af2-pill-live", label: "in flight" };
}

function progressColor(status: string): string {
  if (status === "blocked") return "var(--af2-clay)";
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

function missionLinkTo(mission: Mission): string {
  if (mission.latestHiringPlanId) {
    return `/hire/plan/${mission.id}/${mission.latestHiringPlanId}`;
  }
  return "/hire";
}

function ownerFor(mission: Mission): { display: string; sub: string } {
  const company = mission.companyName?.trim() || "Workspace";
  const first = company.split(/\s+/)[0] ?? company;
  return { display: company, sub: `Owner · ${first}` };
}

export default function MissionState() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("in_flight");

  useEffect(() => {
    document.title = "Missions | AutoFlow";
  }, []);

  const loadMissions = useCallback(async () => {
    if (!activeWorkspaceId) {
      setMissions([]);
      setLoading(false);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const token = await requireAccessToken();
      const list = await listMissions(token);
      setMissions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load missions");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, requireAccessToken]);

  useEffect(() => {
    void loadMissions();
  }, [loadMissions]);

  const counts = useMemo(() => {
    const result: Record<TabKey, number> = {
      in_flight: 0,
      review: 0,
      scheduled: 0,
      done: 0,
      all: missions.length,
    };
    for (const tab of TABS) {
      if (tab.key === "all") continue;
      result[tab.key] = missions.filter(tab.match).length;
    }
    return result;
  }, [missions]);

  const visibleMissions = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
    return missions.filter(tab.match);
  }, [missions, activeTab]);

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
          <button type="button" className="af2-btn">
            Templates
          </button>
          <Link to="/hire" className="af2-btn af2-btn-clay" style={{ textDecoration: "none" }}>
            ＋ New mission
          </Link>
        </div>
      </div>

      <div className="af2-tabs">
        {TABS.map((tab) => {
          const label =
            tab.key === "all" ? tab.label : `${tab.label} (${counts[tab.key]})`;
          return (
            <button
              key={tab.key}
              type="button"
              className={`af2-tab${activeTab === tab.key ? " active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingState label="Loading missions…" />
      ) : error ? (
        <ErrorState
          title="Missions unavailable"
          message={error}
          onRetry={() => void loadMissions()}
        />
      ) : visibleMissions.length === 0 ? (
        <div className="af2-card" style={{ padding: 24, textAlign: "center" }}>
          <div className="af2-muted" style={{ fontSize: 13 }}>
            No missions in this view yet.{" "}
            <Link
              to="/hire"
              className="af2-btn af2-btn-ghost af2-btn-sm"
              style={{ display: "inline-flex", marginLeft: 8 }}
            >
              Brief one →
            </Link>
          </div>
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

            return (
              <Link
                key={mission.id}
                to={missionLinkTo(mission)}
                className="af2-card"
                style={{
                  padding: 20,
                  cursor: "pointer",
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                <div className="af2-row">
                  <span
                    className="af2-mono af2-muted-2"
                    style={{ fontSize: 11 }}
                  >
                    {shortId(mission.id)}
                  </span>
                  <span className="af2-spacer" />
                  <span className={pill.className}>
                    <span className="af2-dot" />
                    {pill.label}
                  </span>
                </div>
                <div
                  className="af2-h3"
                  style={{ marginTop: 8, fontSize: 18 }}
                >
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
                    style={{
                      width: `${progress * 100}%`,
                      height: "100%",
                      background: color,
                    }}
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
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {owner.display}
                  </span>
                  <span className="af2-muted" style={{ fontSize: 12 }}>
                    · {owner.sub}
                  </span>
                  <span className="af2-spacer" />
                  <span
                    className="af2-mono af2-muted"
                    style={{ fontSize: 11.5 }}
                  >
                    {dueText(mission)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
