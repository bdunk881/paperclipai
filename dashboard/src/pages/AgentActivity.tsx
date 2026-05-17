import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listObservabilityEvents,
  type ObservabilityEvent,
} from "../api/observability";
import { listRunsByStatus, retryRun } from "../api/runsApi";
import type { WorkflowRun } from "../types/workflow";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

// HEL-29 / HEL-60 v2: poll the observability feed every 5s while on the
// Live tab so the timeline reflows in place. The interval is cleared when
// the tab is not "Live" and on unmount.
const ACTIVITY_POLL_MS = 5_000;
const FEED_LIMIT = 100;

/**
 * Activity feed (HEL-60 v2 restyle).
 *
 * v2 reference: `docs/design/v2/pages-extra.jsx::AF2_Activity` — `af2-page`
 * chrome, eyebrow "Run · Live", serif h1, time-tabs (Live / Today / This
 * week / All), and an `af2-card` list of timeline rows with mono
 * timestamps, agent avatars, and verb-summary copy.
 *
 * Data source: `listObservabilityEvents` (the canonical observability
 * stream). Live tab polls every 5s; other tabs render the cached batch
 * filtered by `occurredAt`.
 */

type TabKey = "live" | "today" | "week" | "all" | "failed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "live", label: "Live (live)" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All" },
  { key: "failed", label: "Failed" },
];

const LIVE_WINDOW_MS = 5 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function actorDisplayName(event: ObservabilityEvent): string {
  return event.actor.label ?? event.actor.id ?? "system";
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "system";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) {
    const word = parts[0];
    return (word[0] ?? "·").concat(word[1] ?? "").toUpperCase();
  }
  return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase();
}

/**
 * Derive a human verb phrase from an observability `event.type`. Well-known
 * event types get a hand-tuned label; anything else falls back to the
 * dot-separated parts of the type joined by a space.
 */
function verbFromType(type: string): string {
  const known: Record<string, string> = {
    "run.started": "started",
    "run.completed": "completed",
    "run.failed": "failed",
    "approval.requested": "filed approval",
    "approval.resolved": "resolved approval",
    "budget.exceeded": "exceeded budget",
    "alert.raised": "raised alert",
    "issue.created": "opened issue",
    "issue.resolved": "resolved issue",
    "heartbeat.recorded": "checked in",
    "ticket.opened": "opened mission assignment",
  };
  if (known[type]) return known[type];
  return type.split(".").join(" ");
}

/**
 * Render a small colored badge for events whose payload metadata
 * carries a `source` tag (Wave 5 check-in / hand-off via the agent
 * actions routes). Returns null for events without a recognized
 * source so the row stays uncluttered.
 */
function sourceBadge(event: { payload?: unknown }): {
  label: string;
  color: string;
  bg: string;
} | null {
  const payload = event.payload as { metadata?: { source?: string } } | undefined;
  const source = payload?.metadata?.source;
  if (source === "check-in") {
    return {
      label: "via Check-in",
      color: "var(--af2-mustard)",
      bg: "rgba(192,142,58,0.12)",
    };
  }
  if (source === "handoff") {
    return {
      label: "via Hand-off",
      color: "var(--af2-sage)",
      bg: "rgba(90,122,90,0.12)",
    };
  }
  return null;
}

function filterEventsForTab(
  events: ObservabilityEvent[],
  tab: TabKey,
  now: number,
): ObservabilityEvent[] {
  if (tab === "all") return events;

  return events.filter((event) => {
    const ts = new Date(event.occurredAt).getTime();
    if (Number.isNaN(ts)) return false;

    if (tab === "live") {
      return now - ts <= LIVE_WINDOW_MS;
    }
    if (tab === "week") {
      return now - ts <= WEEK_WINDOW_MS;
    }
    // "today"
    const eventDay = new Date(ts);
    const today = new Date(now);
    return (
      eventDay.getFullYear() === today.getFullYear() &&
      eventDay.getMonth() === today.getMonth() &&
      eventDay.getDate() === today.getDate()
    );
  });
}

function formatFailedAt(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AgentActivity() {
  const { accessMode, requireAccessToken } = useAuth();
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [failedRuns, setFailedRuns] = useState<WorkflowRun[]>([]);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabKey>("live");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of `Date.now()` used to compute live/today/week windows.
  // Refreshed every poll so the Live tab actually expires old events.
  const [now, setNow] = useState<number>(() => Date.now());

  const loadEvents = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        if (accessMode === "preview") {
          setEvents([]);
          setNow(Date.now());
          return;
        }
        const token = await requireAccessToken();
        const page = await listObservabilityEvents(token, { limit: FEED_LIMIT });
        setEvents(page.events);
        setNow(Date.now());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load activity");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accessMode, requireAccessToken],
  );

  const loadFailedRuns = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        if (accessMode === "preview") {
          setFailedRuns([]);
          return;
        }
        const token = await requireAccessToken();
        const { runs } = await listRunsByStatus(token, "failed");
        setFailedRuns(runs);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load failed runs");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accessMode, requireAccessToken],
  );

  useEffect(() => {
    if (tab === "failed") {
      void loadFailedRuns();
    } else {
      void loadEvents();
    }
  }, [tab, loadEvents, loadFailedRuns]);

  // Live polling: only refresh while the Live tab is active AND the tab is
  // visible. Background polling burns through the 100 req/min general API
  // rate limiter without the user ever seeing the result; the visibility
  // gate also pauses polling when the user switches windows so reopening
  // dev.helloautoflow.com after lunch doesn't spam 12 backed-up requests.
  useEffect(() => {
    if (accessMode === "preview") return;
    if (tab !== "live") return;
    if (typeof document !== "undefined" && document.hidden) return;

    const interval = window.setInterval(() => {
      void loadEvents(true);
    }, ACTIVITY_POLL_MS);

    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(interval);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accessMode, loadEvents, tab]);

  const handleRetry = useCallback(
    async (runId: string): Promise<void> => {
      setRetryingIds((prev) => new Set(prev).add(runId));
      try {
        const token = await requireAccessToken();
        await retryRun(token, runId);
        // Optimistically remove from the failed list once re-queued.
        setFailedRuns((prev) => prev.filter((r) => r.id !== runId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Retry failed");
      } finally {
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
      }
    },
    [requireAccessToken],
  );

  const filtered = useMemo(
    () => filterEventsForTab(events, tab, now),
    [events, now, tab],
  );

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Streaming agent activity..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState
          title="Signal Lost"
          message={error}
          onRetry={() => void (tab === "failed" ? loadFailedRuns() : loadEvents())}
        />
      </div>
    );
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Live</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Activity
          </h1>
          <div className="af2-page-head-meta">
            Every move your team makes — searchable, exportable, with receipts.
          </div>
        </div>
        <div className="af2-page-actions">
          <button
            type="button"
            className="af2-btn"
            // TODO(HEL-60): wire to /observability/events?format=csv
            onClick={() => {
              /* no-op for now */
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="af2-btn"
            // TODO(HEL-60): event-type filter modal
            onClick={() => {
              /* no-op for now */
            }}
          >
            Filter
          </button>
        </div>
      </div>

      <div className="af2-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`af2-tab${tab === t.key ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "failed" ? (
        <div className="af2-card" style={{ padding: 0 }}>
          {failedRuns.map((run, index) => {
            const isRetrying = retryingIds.has(run.id);
            const shortId = run.id.slice(0, 8);
            const reason = run.failureReason ?? run.error ?? "Unknown error";
            return (
              <div
                key={run.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr 1fr 100px",
                  gap: 14,
                  padding: "11px 18px",
                  borderBottom:
                    index < failedRuns.length - 1
                      ? "1px solid var(--af2-line)"
                      : "none",
                  alignItems: "center",
                }}
              >
                <span
                  className="af2-mono af2-muted-2"
                  style={{ fontSize: 11 }}
                  title={run.failedAt ?? run.completedAt}
                >
                  {formatFailedAt(run.failedAt ?? run.completedAt)}
                </span>

                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{run.templateName}</div>
                  <div className="af2-mono af2-muted" style={{ fontSize: 11 }}>
                    {shortId}…
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: "var(--af2-clay, #c0392b)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={reason}
                >
                  {reason.slice(0, 120)}
                </div>

                <button
                  type="button"
                  disabled={isRetrying}
                  onClick={() => void handleRetry(run.id)}
                  className="af2-btn af2-btn-sm"
                  style={{ justifySelf: "end" }}
                >
                  {isRetrying ? "…" : "Retry"}
                </button>
              </div>
            );
          })}

          {failedRuns.length === 0 ? (
            <div
              style={{
                padding: "18px",
                fontSize: 13,
                color: "var(--af2-ink-3)",
                textAlign: "center",
              }}
            >
              No failed runs. All clear.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="af2-card" style={{ padding: 0 }}>
          {filtered.map((event, index) => {
            const displayName = actorDisplayName(event);
            const first = firstName(displayName);
            const verb = verbFromType(event.type);
            return (
              <div
                key={event.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 36px 1fr 80px",
                  gap: 14,
                  padding: "11px 18px",
                  borderBottom:
                    index < filtered.length - 1
                      ? "1px solid var(--af2-line)"
                      : "none",
                  alignItems: "center",
                }}
              >
                <span
                  className="af2-mono af2-muted-2"
                  style={{ fontSize: 11 }}
                  title={new Date(event.occurredAt).toLocaleString()}
                >
                  {formatTime(event.occurredAt)}
                </span>

                <div
                  aria-label={displayName}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--af2-clay-soft)",
                    color: "var(--af2-clay-2, var(--af2-clay))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  {initials(displayName)}
                </div>

                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <strong>{first}</strong>
                  <span className="af2-muted"> {verb} </span>
                  <span style={{ color: "var(--af2-ink)" }}>{event.summary}</span>
                </div>

                <a
                  href={`/agents/activity?focus=${encodeURIComponent(event.id)}`}
                  className="af2-btn af2-btn-ghost af2-btn-sm"
                  style={{
                    justifySelf: "end",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Details →
                </a>
              </div>
            );
          })}

          {filtered.length === 0 ? (
            <div
              style={{
                padding: "18px",
                fontSize: 13,
                color: "var(--af2-ink-3)",
                textAlign: "center",
              }}
            >
              No activity matches this view yet.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
