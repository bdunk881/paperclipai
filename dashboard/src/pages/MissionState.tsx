/**
 * Missions page — v2 prototype port (consolidation.html lines 650-712).
 *
 * Eyebrow "Run", h1 "Missions". Filterbar uses a seg control
 * (Live/Archived/All) + search, and the list renders card-list rows
 * with M-* ids, status pill, started timestamp, spend, plus inline
 * Stop / Complete actions. Clicking a row toggles a drawer with
 * Statement / Team / Assignments subtabs.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Mission } from "../api/missionsApi";
import { CompleteMissionModal } from "../components/missions/CompleteMissionModal";
import { StopMissionModal } from "../components/missions/StopMissionModal";
import { missionLinkTo } from "../lib/missionNavigation";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";

type StatusFilter = "live" | "archived" | "all";
type DrawerTab = "statement" | "team" | "assignments";

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

function isArchived(status: string): boolean {
  return status === "archived" || status === "completed" || status === "stopped";
}

function pillFor(status: string): { tone: string; label: string } {
  if (status === "blocked") return { tone: "clay", label: "blocked" };
  if (status === "review" || status === "awaiting_approval")
    return { tone: "mustard", label: "review" };
  if (status === "scheduled" || status === "draft")
    return { tone: "", label: status };
  if (status === "completed") return { tone: "sage", label: "done" };
  if (status === "archived") return { tone: "", label: "archived" };
  if (status === "stopped") return { tone: "clay", label: "stopped" };
  return { tone: "mustard", label: "at risk" };
}

function relativeStarted(iso: string | undefined): string {
  if (!iso) return "started recently";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "started recently";
  const diffDays = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "started today";
  if (diffDays === 1) return "started 1d ago";
  return `started ${diffDays}d ago`;
}

export default function MissionState() {
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const missionsQuery = useMissionsQuery();
  const missions = missionsQuery.data ?? [];

  const initialFilter = (searchParams.get("status") as StatusFilter | null) ?? "live";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "live",
  );
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("statement");
  const [completeTarget, setCompleteTarget] = useState<Mission | null>(null);
  const [stopTarget, setStopTarget] = useState<Mission | null>(null);

  useEffect(() => {
    document.title = "Missions | AutoFlow";
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter === "live") next.delete("status");
    else next.set("status", statusFilter);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const visible = useMemo(() => {
    return missions
      .filter((m) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "archived") return isArchived(m.status);
        return !isArchived(m.status);
      })
      .filter((m) =>
        search.trim()
          ? m.statement.toLowerCase().includes(search.trim().toLowerCase())
          : true,
      );
  }, [missions, search, statusFilter]);

  const refreshAfterMutation = async () => {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.missions(activeWorkspaceId),
    });
  };

  const counts = useMemo(() => {
    let live = 0;
    let archived = 0;
    for (const m of missions) {
      if (isArchived(m.status)) archived += 1;
      else live += 1;
    }
    return { live, archived, all: missions.length };
  }, [missions]);

  return (
    <div className="af2-v2">
      <div className="page-head">
        <div className="page-head-left">
          <div className="eyebrow">Run</div>
          <h1 className="h1">Missions</h1>
          <div className="meta">
            {counts.live} live · {counts.archived} archived · click a row to
            expand inline
          </div>
        </div>
        <div className="page-head-right">
          <button
            type="button"
            className="btn primary"
            onClick={() => navigate("/hire")}
          >
            + New mission
          </button>
        </div>
      </div>

      <div className="filterbar">
        <div className="seg">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-selected={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search statement…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grow" />
        <span style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>
          {visible.length} missions
        </span>
      </div>

      <div className="card card-list" style={{ padding: 0 }}>
        {missions.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", fontSize: 13 }}>
            <p className="desc" style={{ marginBottom: 12 }}>
              No active missions yet.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate("/hire")}
            >
              + New mission
            </button>
          </div>
        ) : (
          visible.map((m) => {
              const isOpen = openId === m.id;
              const pill = pillFor(m.status);
              const archived = isArchived(m.status);
              const shortId = m.id.slice(0, 8).toUpperCase();
              return (
                <div key={m.id}>
                  <div
                    className={`row${isOpen ? " expanded" : ""}`}
                    style={{
                      gridTemplateColumns: "80px 1fr 110px 130px 100px 180px",
                    }}
                    onClick={() => {
                      if (isOpen) setOpenId(null);
                      else {
                        setOpenId(m.id);
                        setDrawerTab("statement");
                      }
                    }}
                  >
                    <div className="id">{shortId}</div>
                    <div>
                      <b>{m.statement}</b>
                      <br />
                      <span
                        style={{ color: "var(--af2-ink-3)", fontSize: 12 }}
                      >
                        {m.companyName}
                      </span>
                    </div>
                    <div>
                      <span className={`pill dot ${pill.tone}`}>{pill.label}</span>
                    </div>
                    <div className="id">{relativeStarted(m.createdAt)}</div>
                    <div>—</div>
                    <div className="actions">
                      {!archived ? (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStopTarget(m);
                            }}
                          >
                            Stop
                          </button>
                          <button
                            type="button"
                            className="btn sage sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompleteTarget(m);
                            }}
                          >
                            Complete
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(missionLinkTo(m));
                          }}
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`row-drawer${isOpen ? " open" : ""}`}>
                    <div className="row-drawer-head">
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 4 }}>
                          Mission · {archived ? "archived" : "live"}
                        </div>
                        <h3>{m.statement}</h3>
                      </div>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(null);
                        }}
                      >
                        Collapse ↑
                      </button>
                    </div>
                    <div className="subtabs">
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
                          className="subtab"
                          aria-selected={drawerTab === t.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerTab(t.key);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {drawerTab === "statement" ? (
                      <p style={{ fontSize: 13 }}>{m.statement}</p>
                    ) : drawerTab === "team" ? (
                      <p style={{ fontSize: 13, color: "var(--af2-ink-3)" }}>
                        Team breakdown for this mission appears here once team
                        assembly completes.
                      </p>
                    ) : (
                      <p style={{ fontSize: 13, color: "var(--af2-ink-3)" }}>
                        Per-agent assignments roll up here once tasks ship.
                      </p>
                    )}
                  </div>
                </div>
              );
            })
        )}
        {missions.length > 0 && visible.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--af2-ink-3)",
              fontSize: 13,
            }}
          >
            No missions match this view yet.
          </div>
        ) : null}
      </div>

      {/* Real-mission modals */}
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

