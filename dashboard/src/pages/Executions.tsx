/**
 * Executions (HEL-703) — the workspace's run history with rich filtering.
 *
 * Lists runs newest-first with status / workflow / tag (server-side, on the
 * HEL-704 filter) and date-range (client-side) filters, a retry action on
 * failed runs, and per-row drill-in to the run timeline (RunDetail). Mirrors
 * n8n's "All Executions" + trigger.dev's runs explorer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listTemplates, type TemplateSummary } from "../api/client";
import { listRuns, retryRun } from "../api/runsApi";
import type { WorkflowRun } from "../types/workflow";
import { ErrorState, LoadingState } from "../components/UiStates";

const STATUS_OPTIONS = [
  "all",
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "canceled",
] as const;

const STATUS_TONE: Record<string, string> = {
  completed: "#16a34a",
  failed: "#b91c1c",
  running: "#2563eb",
  queued: "#6b7280",
  pending: "#6b7280",
  awaiting_approval: "#d97706",
  escalated: "#d97706",
  canceled: "#6b7280",
  cancelling: "#6b7280",
};

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(run: WorkflowRun): string {
  const start = Date.parse(run.startedAt);
  const end = run.completedAt ? Date.parse(run.completedAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

const TERMINAL = new Set(["failed", "canceled"]);

export default function Executions() {
  const { requireAccessToken } = useAuth();

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filters
  const [status, setStatus] = useState<string>("all");
  const [templateId, setTemplateId] = useState<string>("");
  const [tagsText, setTagsText] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const [runsRes, templateList] = await Promise.all([
        listRuns(token, {
          ...(status !== "all" ? { status } : {}),
          ...(templateId ? { templateId } : {}),
          ...(tags.length > 0 ? { tags } : {}),
        }),
        listTemplates(undefined, token).catch(() => [] as TemplateSummary[]),
      ]);
      setRuns(runsRes.runs);
      setTemplates(templateList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load executions");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, status, templateId, tagsText]);

  useEffect(() => {
    void load();
  }, [load]);

  // Date range is applied client-side (the runs API filters by status/template/tag).
  const visibleRuns = useMemo(() => {
    const fromMs = from ? Date.parse(from) : NaN;
    const toMs = to ? Date.parse(to) + 86_400_000 : NaN; // inclusive of the "to" day
    return runs.filter((run) => {
      const startedAt = Date.parse(run.startedAt);
      if (!Number.isFinite(startedAt)) return true;
      if (Number.isFinite(fromMs) && startedAt < fromMs) return false;
      if (Number.isFinite(toMs) && startedAt > toMs) return false;
      return true;
    });
  }, [runs, from, to]);

  async function handleRetry(runId: string) {
    setActionError(null);
    setRetryingId(runId);
    try {
      const token = await requireAccessToken();
      await retryRun(token, runId);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 1040 }}>
      <div className="af2-page-head">
        <div className="af2-eyebrow">Build · Executions</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>Executions</h1>
        <p style={{ margin: "6px 0 0", color: "var(--af2-ink-soft, #6b7280)", fontSize: 13 }}>
          Every workflow run in this workspace. Filter by status, workflow, tag, or date; retry a
          failed run, or open one to see its step timeline.
        </p>
      </div>

      <div
        className="af2-card"
        style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
      >
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Status</span>
          <select className="af2-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Workflow</span>
          <select className="af2-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">All workflows</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Tags</span>
          <input
            className="af2-input"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="comma-separated"
            aria-label="Filter by tags"
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>From</span>
          <input className="af2-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>To</span>
          <input className="af2-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>

        <button type="button" className="af2-btn af2-btn-ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {actionError && (
        <div style={{ color: "var(--af2-danger, #b91c1c)", fontSize: 13, marginBottom: 10 }}>{actionError}</div>
      )}

      {loading ? (
        <LoadingState label="Loading executions…" />
      ) : error ? (
        <ErrorState title="Couldn't load executions" message={error} onRetry={() => void load()} />
      ) : visibleRuns.length === 0 ? (
        <div className="af2-card" style={{ padding: 24, textAlign: "center", color: "var(--af2-ink-soft, #6b7280)" }}>
          No executions match these filters.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }} role="list" aria-label="Executions">
          {visibleRuns.map((run) => (
            <div
              key={run.id}
              role="listitem"
              className="af2-card"
              data-testid="execution-row"
              style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}
            >
              <span
                style={{
                  flex: "0 0 96px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: STATUS_TONE[run.status] ?? "#6b7280",
                  textTransform: "capitalize",
                }}
              >
                {run.status.replace(/_/g, " ")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.templateName || run.templateId}
                </div>
                <div style={{ fontSize: 12, color: "var(--af2-ink-soft, #6b7280)", marginTop: 2 }}>
                  {formatRelative(run.startedAt)} · {formatDuration(run)}
                  {run.tags && run.tags.length > 0 ? ` · ${run.tags.join(", ")}` : ""}
                </div>
              </div>
              {TERMINAL.has(run.status) && (
                <button
                  type="button"
                  className="af2-btn af2-btn-ghost"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => void handleRetry(run.id)}
                  disabled={retryingId === run.id}
                >
                  {retryingId === run.id ? "Retrying…" : "Retry"}
                </button>
              )}
              <Link to={`/runs/${run.id}`} className="af2-btn af2-btn-ghost" style={{ flex: "0 0 auto" }}>
                View →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
