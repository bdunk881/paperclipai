/**
 * Mission hub — statement, team link, hiring plan, retire / discard actions.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Trash2, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import { ErrorState, LoadingState } from "../components/UiStates";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";
import {
  deleteMission,
  getMission,
  retireMissionTeam,
  type Mission,
} from "../api/missionsApi";
import { isMissionActiveWithTeam, teamLinkForMission } from "../lib/missionNavigation";

function pillFor(status: string): { className: string; label: string } {
  if (status === "archived" || status === "completed") {
    return { className: "af2-pill", label: status === "archived" ? "archived" : "done" };
  }
  if (status === "review" || status === "awaiting_approval") {
    return { className: "af2-pill af2-pill-pending", label: "review" };
  }
  if (status === "blocked") {
    return { className: "af2-pill af2-pill-clay", label: "blocked" };
  }
  return { className: "af2-pill af2-pill-live", label: "in flight" };
}

export default function MissionDetail() {
  const { missionId } = useParams<{ missionId: string }>();
  const navigate = useNavigate();
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [mission, setMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  const load = useCallback(async () => {
    if (!missionId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const row = await getMission(missionId, token);
      if (!row) {
        setError("Mission not found");
        setMission(null);
        return;
      }
      setMission(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mission");
    } finally {
      setLoading(false);
    }
  }, [missionId, requireAccessToken]);

  useEffect(() => {
    document.title = "Mission | AutoFlow";
    void load();
  }, [load]);

  async function handleDiscard() {
    if (!mission) return;
    setWorking(true);
    try {
      const token = await requireAccessToken();
      await deleteMission(mission.id, token);
      toast.success("Mission discarded.");
      navigate("/mission-state");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete mission";
      if (msg.includes("retire the team")) {
        setDeleteBlocked(true);
        setDiscardOpen(false);
        setRetireOpen(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setWorking(false);
    }
  }

  async function handleRetire() {
    if (!mission) return;
    setWorking(true);
    try {
      const token = await requireAccessToken();
      const result = await retireMissionTeam(mission.id, token);
      toast.success(
        `Team retired (${result.retiredAgentCount} agent${result.retiredAgentCount === 1 ? "" : "s"}).`,
      );
      setRetireOpen(false);
      setDeleteBlocked(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retire team");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading mission…" />;
  }

  if (error || !mission) {
    return (
      <ErrorState
        title="Mission unavailable"
        message={error ?? "Not found"}
        onRetry={() => void load()}
      />
    );
  }

  const pill = pillFor(mission.status);
  const successMetric = mission.metadata?.successMetric?.trim() || "—";
  const canRetire = isMissionActiveWithTeam(mission) && mission.status !== "archived";
  const statementPreview =
    mission.statement.length > 200
      ? `${mission.statement.slice(0, 200)}…`
      : mission.statement;

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Mission</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Mission
          </h1>
          <div className="af2-page-head-meta">
            <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
              {mission.id.slice(0, 8).toUpperCase()}
            </span>
            <span style={{ margin: "0 8px" }}>·</span>
            <span>{mission.companyName}</span>
          </div>
        </div>
        <div className="af2-page-actions">
          <Link to="/mission-state" className="af2-btn" style={{ textDecoration: "none" }}>
            All missions
          </Link>
          {mission.latestHiringPlanId ? (
            <Link
              to={`/hire/plan/${mission.id}/${mission.latestHiringPlanId}`}
              className="af2-btn"
              style={{ textDecoration: "none" }}
            >
              Hiring plan
            </Link>
          ) : null}
          {isMissionActiveWithTeam(mission) ? (
            <Link
              to={teamLinkForMission(mission.id)}
              className="af2-btn af2-btn-primary"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Users size={14} />
              View team
            </Link>
          ) : null}
        </div>
      </div>

      <div className="af2-card" style={{ padding: 24, maxWidth: 820 }}>
        <div className="af2-row" style={{ marginBottom: 12 }}>
          <span className={pill.className}>
            <span className="af2-dot" />
            {pill.label}
          </span>
        </div>
        <p
          className="font-af2-serif"
          style={{ fontSize: 20, lineHeight: 1.45, margin: 0, color: "var(--af2-ink)" }}
        >
          {mission.statement}
        </p>
        <div className="af2-muted" style={{ fontSize: 13, marginTop: 14 }}>
          Success metric · {successMetric}
        </div>
      </div>

      <div className="af2-row" style={{ marginTop: 20, gap: 10, flexWrap: "wrap" }}>
        {canRetire ? (
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            onClick={() => setRetireOpen(true)}
          >
            Retire team
          </button>
        ) : null}
        <button
          type="button"
          className="af2-btn af2-btn-sm"
          style={{ color: "var(--af2-clay)" }}
          onClick={() => setDiscardOpen(true)}
        >
          <Trash2 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {mission.status === "archived" ? "Delete mission" : "Discard mission"}
        </button>
      </div>

      <ConfirmDestructiveModal
        open={discardOpen}
        onClose={() => {
          setDiscardOpen(false);
          setDeleteBlocked(false);
        }}
        eyebrow="Discard mission"
        title="Discard this mission?"
        message={`"${statementPreview}"\n\nAny draft hiring plan will also be deleted. This can't be undone.${
          deleteBlocked
            ? "\n\nThis mission still has a live team. Retire the team first, then discard."
            : ""
        }`}
        confirmLabel={mission.status === "archived" ? "Delete mission" : "Discard mission"}
        confirming={working}
        onConfirm={() => void handleDiscard()}
        secondaryLabel={deleteBlocked ? "Retire team first" : undefined}
        onSecondary={
          deleteBlocked
            ? () => {
                setDiscardOpen(false);
                setRetireOpen(true);
              }
            : undefined
        }
      />

      <ConfirmDestructiveModal
        open={retireOpen}
        onClose={() => setRetireOpen(false)}
        eyebrow="Retire team"
        title="Retire this mission's team?"
        message={`All agents on "${statementPreview}" will be terminated and removed from the org chart. The mission will be archived. You can delete the mission afterward.`}
        confirmLabel="Retire team"
        confirming={working}
        onConfirm={() => void handleRetire()}
        secondaryLabel={deleteBlocked ? "Then discard mission" : undefined}
        onSecondary={
          deleteBlocked
            ? () => {
                void (async () => {
                  await handleRetire();
                  setDiscardOpen(true);
                })();
              }
            : undefined
        }
      />
    </div>
  );
}
