/**
 * Run detail / step timeline (HEL-562, FEATURE_REVIEW.md §D2).
 *
 * Makes a run's "paper trail" visible: per-step status, output, cost, duration
 * and error, with a Replay-from-step action on failed steps. Reads the run via
 * the existing GET /api/runs/:id (its embedded `stepResults` carry everything
 * the timeline needs), so there's no new endpoint or schema change.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import { getRun, replayRunFromStep } from "../api/client";
import type { WorkflowRun } from "../types/workflow";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, LoadingState } from "../components/UiStates";

type Step = WorkflowRun["stepResults"][number];

// A run is replayable-from-step only after it has stopped at a failure.
const REPLAYABLE = new Set<WorkflowRun["status"]>(["failed", "escalated"]);

const MONO: React.CSSProperties = { fontFamily: "var(--af2-mono)" };

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function runDurationMs(run: WorkflowRun): number {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return end - start;
}

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayingIndex, setReplayingIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      setRun(await getRun(runId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [runId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReplay(stepIndex: number): Promise<void> {
    if (!runId) return;
    setReplayingIndex(stepIndex);
    try {
      const token = await requireAccessToken();
      const newRun = await replayRunFromStep(runId, stepIndex, token);
      toast.success("Replaying from this step — opening the new run.");
      navigate(`/runs/${newRun.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplayingIndex(null);
    }
  }

  if (loading) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <LoadingState label="Loading run…" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <ErrorState
          title="Couldn't load this run"
          message={error ?? "Run not found."}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const steps = run.stepResults ?? [];
  const totalCost = steps.reduce((sum, s) => sum + (s.costLog?.estimatedCostUsd ?? 0), 0);
  const canReplay = REPLAYABLE.has(run.status);

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div className="af2-eyebrow">
          <Link to="/" style={{ color: "var(--af2-clay)", textDecoration: "none" }}>
            Activity
          </Link>{" "}
          · Run detail
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <h1 className="af2-h1" style={{ margin: 0 }}>
            {run.templateName || "Run"}
          </h1>
          <StatusBadge status={run.status} />
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
            marginTop: 12,
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
          }}
        >
          <span>
            Trigger{" "}
            <span style={{ ...MONO, color: "var(--af2-ink-2)" }}>
              {run.routineId ? "scheduled" : "manual"}
            </span>
          </span>
          <span>
            Started{" "}
            <span style={{ ...MONO, color: "var(--af2-ink-2)" }}>
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </span>
          <span>
            Duration{" "}
            <span style={{ ...MONO, color: "var(--af2-ink-2)" }}>
              {formatDuration(runDurationMs(run))}
            </span>
          </span>
          <span>
            Cost{" "}
            <span style={{ ...MONO, color: "var(--af2-ink-2)" }}>{formatCost(totalCost)}</span>
          </span>
        </div>
        {run.failureReason || run.error ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 6,
              border: "1px solid rgba(194,80,43,0.3)",
              background: "rgba(194,80,43,0.10)",
              color: "var(--af2-clay)",
              fontSize: 13,
            }}
          >
            {run.failureReason || run.error}
          </div>
        ) : null}
      </div>

      {steps.length === 0 ? (
        <div
          className="af2-card"
          style={{ padding: 28, textAlign: "center", color: "var(--af2-ink-3)" }}
        >
          No step results recorded for this run yet.
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((step, i) => (
            <StepNode
              key={step.stepId || i}
              step={step}
              index={i}
              canReplay={canReplay && step.status === "failure"}
              replaying={replayingIndex === i}
              onReplay={() => void handleReplay(i)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepNode({
  step,
  index,
  canReplay,
  replaying,
  onReplay,
}: {
  step: Step;
  index: number;
  canReplay: boolean;
  replaying: boolean;
  onReplay: () => void;
}) {
  const cost = step.costLog?.estimatedCostUsd ?? 0;
  const hasOutput = step.output && Object.keys(step.output).length > 0;
  let outputText = "";
  try {
    outputText = JSON.stringify(step.output, null, 2);
  } catch {
    outputText = String(step.output);
  }

  return (
    <li className="af2-card" style={{ padding: 16, marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ ...MONO, fontSize: 12, color: "var(--af2-ink-4)" }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <strong style={{ fontSize: 14 }}>{step.stepName || step.stepId}</strong>
          <StatusBadge status={step.status} />
        </div>
        <span style={{ ...MONO, fontSize: 12, color: "var(--af2-ink-3)" }}>
          {formatDuration(step.durationMs)} · {formatCost(cost)}
        </span>
      </div>

      {step.error ? (
        <div
          style={{
            ...MONO,
            marginTop: 10,
            padding: "8px 11px",
            borderRadius: 6,
            background: "rgba(194,80,43,0.10)",
            border: "1px solid rgba(194,80,43,0.25)",
            color: "var(--af2-clay)",
            fontSize: 12.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {step.error}
        </div>
      ) : null}

      {hasOutput ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--af2-ink-3)" }}>
            Output
          </summary>
          <pre
            style={{
              ...MONO,
              marginTop: 8,
              padding: "10px 12px",
              background: "var(--af2-paper-2)",
              border: "1px solid var(--af2-line)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--af2-ink-2)",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {outputText}
          </pre>
        </details>
      ) : null}

      {canReplay ? (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            disabled={replaying}
            onClick={onReplay}
          >
            {replaying ? "Replaying…" : "Replay from here ↻"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
