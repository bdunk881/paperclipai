import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, Search } from "lucide-react";
import {
  getAgentHeartbeat,
  listAgentRuns,
  listAgents,
  type AgentHeartbeat,
  type AgentRun,
} from "../api/agentApi";
import { listActivityEvents, type ActivityEvent } from "../api/activityApi";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

// HEL-29: poll the canonical activity feed every 5s and merge new events
// into the timeline alongside the per-agent heartbeats + runs.
const ACTIVITY_POLL_MS = 5_000;

/**
 * Activity feed (HEL-60 v2 restyle).
 *
 * v2 reference: `docs/design/v2/pages-extra.jsx::AF2_Activity` — `af2-page`
 * chrome, eyebrow "Run · Live", serif h1, time-tabs (Live / Today / This
 * week / All), and an `af2-card` list of timeline rows with mono timestamps,
 * agent avatars, and verb-summary copy.
 *
 * Data wiring kept from the previous implementation: still pulls
 * agent runs + heartbeats via the existing `listAgents` / `listAgentRuns`
 * / `getAgentHeartbeat` API (polling on mount only — SSE / real-time push
 * is tracked separately under HEL-29).
 */

type ActivityStatus = "success" | "warning" | "info";

type ActivityItem = {
  id: string;
  agentName: string;
  action: string;
  summary: string;
  status: ActivityStatus;
  tokenUsage: number;
  createdAt: string;
};

function statusIcon(status: ActivityStatus) {
  if (status === "success") return <CircleCheck size={14} className="text-af2-sage" />;
  if (status === "warning") return <CircleAlert size={14} className="text-af2-clay" />;
  return <CircleDashed size={14} className="text-af2-clay" />;
}

function statusTone(status: ActivityStatus): "sage" | "clay" | "mustard" {
  if (status === "success") return "sage";
  if (status === "warning") return "clay";
  return "mustard";
}

function heartbeatStatusToTone(status: AgentHeartbeat["status"]): ActivityStatus {
  if (status === "running") return "success";
  if (status === "error") return "warning";
  return "info";
}

function runStatusToTone(status: AgentRun["status"]): ActivityStatus {
  if (status === "completed") return "success";
  if (status === "failed" || status === "blocked") return "warning";
  return "info";
}

/**
 * Maps a canonical activity_events row (`hiring_plan_accepted`,
 * `agent_provisioned`, `run.started`, etc.) into the legacy
 * ActivityItem shape so it merges naturally into the existing timeline.
 */
function activityEventToItem(event: ActivityEvent): ActivityItem {
  const subject = event.subject as Record<string, unknown>;
  const payload = event.payload as Record<string, unknown>;
  const actor = event.actor as Record<string, unknown>;

  // Pick a reasonable display name for the actor (user id) and summary line.
  const actorName =
    (typeof actor.label === "string" ? actor.label : undefined) ??
    (typeof actor.id === "string" ? actor.id : "system");

  // Map well-known kinds to operator-meaningful labels + status.
  const KIND_TO_STATUS: Record<string, ActivityStatus> = {
    hiring_plan_accepted: "success",
    agent_provisioned: "success",
    "run.completed": "success",
    "run.started": "info",
    "run.failed": "warning",
    "approval.requested": "info",
    "approval.resolved": "success",
  };

  const status: ActivityStatus = KIND_TO_STATUS[event.kind] ?? "info";

  // Build a readable summary from the subject + payload.
  const subjectLabel =
    (typeof subject.label === "string" ? subject.label : undefined) ??
    (typeof subject.id === "string" ? subject.id : event.kind);
  const summary =
    (typeof payload.summary === "string" ? payload.summary : undefined) ??
    JSON.stringify(payload).slice(0, 240);

  return {
    id: `activity-${event.id}`,
    agentName: actorName,
    action: event.kind,
    summary: `${subjectLabel}: ${summary}`,
    status,
    tokenUsage: 0,
    createdAt: event.occurredAt,
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function agentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function agentToneClass(agentName: string): string {
  // Stable per-agent color from the af2 tone palette.
  const tones = ["clay", "sage", "mustard", "plum", "blue", "ink"] as const;
  let hash = 0;
  for (let i = 0; i < agentName.length; i += 1) {
    hash = (hash * 31 + agentName.charCodeAt(i)) | 0;
  }
  const tone = tones[Math.abs(hash) % tones.length];
  return `af2-tone-${tone}`;
}

const STATUS_FILTERS: Array<{ value: "all" | ActivityStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "success", label: "Live" },
  { value: "warning", label: "Blocked" },
  { value: "info", label: "Other" },
];

export default function AgentActivity() {
  const { accessMode, getAccessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ActivityStatus>("all");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (accessMode === "preview" && !token) {
          setActivity([]);
          return;
        }
        if (!token) throw new Error("Authentication session expired.");

        // Fetch all three sources in parallel: legacy heartbeats+runs and
        // canonical activity_events (HEL-29). The canonical feed is the
        // longer-term source; heartbeats+runs stay until the engine writes
        // run.started / run.completed / run.failed into activity_events.
        const [agents, canonicalEvents] = await Promise.all([
          listAgents(token),
          listActivityEvents(token, 50).catch((cause: unknown) => {
            // Non-fatal — agent-derived items still render if the canonical
            // endpoint is unavailable (e.g. in-memory mode pre-HEL-29).
            console.warn("[activity] canonical feed failed:", cause);
            return [] as ActivityEvent[];
          }),
        ]);

        const agentItems = (
          await Promise.all(
            agents.map(async (agent) => {
              const [heartbeat, runs] = await Promise.all([
                getAgentHeartbeat(agent.id, token),
                listAgentRuns(agent.id, token),
              ]);
              const heartbeatItems = heartbeat
                ? [
                    {
                      id: `heartbeat-${heartbeat.id}`,
                      agentName: agent.name,
                      action: `Heartbeat ${heartbeat.status}`,
                      summary: heartbeat.summary ?? "Latest heartbeat recorded for this agent.",
                      status: heartbeatStatusToTone(heartbeat.status),
                      tokenUsage: heartbeat.tokenUsage,
                      createdAt: heartbeat.recordedAt,
                    },
                  ]
                : [];
              const runItems = runs.map((run) => ({
                id: `run-${run.id}`,
                agentName: agent.name,
                action: `Run ${run.status}`,
                summary: run.summary ?? `Agent execution ${run.status}.`,
                status: runStatusToTone(run.status),
                tokenUsage: run.tokenUsage,
                createdAt: run.completedAt ?? run.startedAt ?? run.createdAt,
              }));
              return [...heartbeatItems, ...runItems];
            }),
          )
        ).flat();

        const canonicalItems: ActivityItem[] = canonicalEvents.map(activityEventToItem);

        const merged = [...agentItems, ...canonicalItems].sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        );

        // Dedupe by id (the canonical source might overlap with run items
        // once the engine writes both — for now they have different prefixes
        // so this is purely defensive).
        const seen = new Set<string>();
        const deduped = merged.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });

        setActivity(deduped);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load activity");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accessMode, getAccessToken],
  );

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  // HEL-29 polling: refresh the activity feed every 5 seconds without
  // showing the loading state (silent=true) so the timeline reflows in
  // place. The interval is cleared on unmount.
  useEffect(() => {
    if (accessMode === "preview") return;
    const interval = window.setInterval(() => {
      void loadActivity(true);
    }, ACTIVITY_POLL_MS);
    return () => window.clearInterval(interval);
  }, [accessMode, loadActivity]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activity.filter((item) => {
      const statusMatch = status === "all" || item.status === status;
      const queryMatch =
        q.length === 0 ||
        item.agentName.toLowerCase().includes(q) ||
        item.action.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q);
      return statusMatch && queryMatch;
    });
  }, [activity, query, status]);

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
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadActivity()} />
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
            Every move your team makes — heartbeats, runs, signals. Searchable, with receipts.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/agents/my"
            className="af2-btn"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            Manage deployments
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="af2-tabs">
        {STATUS_FILTERS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`af2-tab${status === tab.value ? " active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 12,
              color: "var(--af2-ink-4)",
              pointerEvents: "none",
            }}
          />
          <input
            className="af2-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: "100%", paddingLeft: 32 }}
            placeholder="Filter activity..."
          />
        </div>
      </div>

      <div className="af2-card" style={{ padding: 0 }}>
        {filtered.map((item, index) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 32px 1fr auto",
              gap: 14,
              padding: "12px 18px",
              borderBottom:
                index < filtered.length - 1 ? "1px solid var(--af2-line)" : "none",
              alignItems: "center",
            }}
          >
            <span
              className="af2-mono af2-muted-2"
              style={{ fontSize: 11 }}
              title={formatRelative(item.createdAt)}
            >
              {formatTime(item.createdAt)}
            </span>

            <div
              className={`af2-avatar sm ${agentToneClass(item.agentName)}`}
              aria-label={item.agentName}
            >
              {agentInitials(item.agentName)}
            </div>

            <div style={{ fontSize: 13, minWidth: 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {statusIcon(item.status)}
                <strong>{item.agentName}</strong>
              </span>
              <span className="af2-muted">{" · "}</span>
              <span>{item.action}</span>
              <span className="af2-muted">{" · "}</span>
              <span style={{ color: "var(--af2-ink)" }}>{item.summary}</span>
            </div>

            <div
              style={{
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              <span
                className={`af2-pill af2-pill-${statusTone(item.status) === "sage" ? "live" : statusTone(item.status) === "clay" ? "clay" : "pending"}`}
              >
                <span className="af2-dot" />
                {item.tokenUsage.toLocaleString()} tok
              </span>
            </div>
          </div>
        ))}

        {filtered.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState
              title={activity.length === 0 ? "No activity yet" : "No activity matches this filter"}
              description="Heartbeats and execution runs will appear here once your agents are deployed and running."
              ctaLabel="Deploy an agent"
              ctaTo="/agents"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
