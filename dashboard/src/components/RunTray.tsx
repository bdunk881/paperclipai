/**
 * RunTray — bottom-right floating card listing the caller's in-flight
 * runs. Server-driven via `useInFlightRuns` so an operator kicking off
 * a long run on laptop sees it on their phone. Auto-hides at zero
 * active runs; minimised/expanded pose is the only piece of local UI
 * state we persist (per workspace).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useInFlightRuns } from "../hooks/useInFlightRuns";
import { useWorkspace } from "../context/useWorkspace";
import type { WorkflowRun } from "../types/workflow";

const POSE_PREFIX = "af2.runTray.pose.v1";

function loadPose(workspaceId: string | null): "expanded" | "collapsed" {
  if (typeof window === "undefined" || !workspaceId) return "expanded";
  try {
    const raw = window.localStorage.getItem(`${POSE_PREFIX}.${workspaceId}`);
    return raw === "collapsed" ? "collapsed" : "expanded";
  } catch {
    return "expanded";
  }
}

function savePose(workspaceId: string | null, pose: "expanded" | "collapsed") {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(`${POSE_PREFIX}.${workspaceId}`, pose);
  } catch {
    /* ignore */
  }
}

function statusPill(status: WorkflowRun["status"]): {
  label: string;
  tone: "sage" | "mustard" | "clay" | "plum" | "";
} {
  switch (status) {
    case "running":
      return { label: "running", tone: "sage" };
    case "queued":
    case "pending":
      return { label: "queued", tone: "mustard" };
    case "awaiting_approval":
      return { label: "needs stamp", tone: "plum" };
    case "cancelling":
      return { label: "cancelling…", tone: "clay" };
    default:
      return { label: status, tone: "" };
  }
}

function elapsed(startedAt: string | null | undefined): string {
  if (!startedAt) return "—";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function RunTray() {
  const { runs, loading, cancel } = useInFlightRuns();
  const { activeWorkspaceId } = useWorkspace();
  const [pose, setPose] = useState<"expanded" | "collapsed">(() =>
    loadPose(activeWorkspaceId ?? null),
  );
  // Re-render every 15s so the elapsed-time labels keep ticking.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (runs.length === 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [runs.length]);

  useEffect(() => {
    setPose(loadPose(activeWorkspaceId ?? null));
  }, [activeWorkspaceId]);

  const ordered = useMemo(() => {
    return runs.slice().sort((a, b) => {
      const tA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tB - tA;
    });
  }, [runs]);

  if (!loading && ordered.length === 0) return null;

  const togglePose = () => {
    const next = pose === "expanded" ? "collapsed" : "expanded";
    setPose(next);
    savePose(activeWorkspaceId ?? null, next);
  };

  return (
    <div
      role="region"
      aria-label="In-flight runs"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        width: 320,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--af2-card)",
        border: "1px solid var(--af2-line)",
        borderRadius: 12,
        boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={togglePose}
        aria-expanded={pose === "expanded"}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          borderBottom:
            pose === "expanded" ? "1px solid var(--af2-line)" : "none",
          cursor: "pointer",
          color: "var(--af2-ink)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <Loader2
          size={13}
          className={ordered.some((r) => r.status === "running") ? "animate-spin" : ""}
          style={{ color: "var(--af2-clay)" }}
        />
        <span style={{ flex: 1, textAlign: "left" }}>
          {ordered.length} run{ordered.length === 1 ? "" : "s"} in flight
        </span>
        {pose === "expanded" ? (
          <ChevronDown size={14} aria-hidden />
        ) : (
          <ChevronUp size={14} aria-hidden />
        )}
      </button>
      {pose === "expanded" ? (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {ordered.map((run) => {
            const pill = statusPill(run.status);
            return (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--af2-line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <Link
                    to={`/runs/${run.id}`}
                    style={{
                      fontWeight: 600,
                      color: "var(--af2-ink)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 200,
                    }}
                    title={run.templateName}
                  >
                    {run.templateName || "Run"}
                  </Link>
                  <span className={`pill dot ${pill.tone}`} style={{ fontSize: 10 }}>
                    {pill.label}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--af2-ink-3)",
                  }}
                >
                  <span
                    style={{
                      fontFamily:
                        "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {elapsed(run.startedAt)} · {run.id.slice(0, 6)}
                  </span>
                  {run.status !== "cancelling" ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => void cancel(run.id)}
                      style={{
                        padding: "2px 6px",
                        fontSize: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Cancel run"
                      aria-label={`Cancel run ${run.id}`}
                    >
                      <X size={11} aria-hidden /> Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
