import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, Search } from "lucide-react";
import {
  getControlPlaneSnapshot,
  type ControlPlaneHeartbeat,
  type ControlPlaneTask,
} from "../api/controlPlane";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

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
  if (status === "success") return <CircleCheck size={14} className="text-teal-600" />;
  if (status === "warning") return <CircleAlert size={14} className="text-orange-600" />;
  return <CircleDashed size={14} className="text-indigo-600" />;
}

function heartbeatStatusToTone(status: ControlPlaneHeartbeat["status"]): ActivityStatus {
  if (status === "completed") return "success";
  if (status === "blocked") return "warning";
  return "info";
}

function taskStatusToTone(status: ControlPlaneTask["status"]): ActivityStatus {
  if (status === "done") return "success";
  if (status === "blocked") return "warning";
  return "info";
}

export default function AgentActivity() {
  const { getAccessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ActivityStatus>("all");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired.");
      const snapshot = await getControlPlaneSnapshot(token);
      const items = snapshot.flatMap((detail) => {
        const agentNames = new Map(detail.agents.map((agent) => [agent.id, agent.name]));
        const heartbeats = detail.heartbeats.map((heartbeat) => ({
          id: `heartbeat-${heartbeat.id}`,
          agentName: agentNames.get(heartbeat.agentId) ?? "Unknown agent",
          action: `Heartbeat ${heartbeat.status}`,
          summary: heartbeat.summary ?? "Heartbeat recorded by the control plane.",
          status: heartbeatStatusToTone(heartbeat.status),
          tokenUsage: Math.round((heartbeat.costUsd ?? 0) * 1000),
          createdAt: heartbeat.completedAt ?? heartbeat.startedAt,
        }));
        const tasks = detail.tasks.map((task) => ({
          id: `task-${task.id}`,
          agentName: task.assignedAgentId ? agentNames.get(task.assignedAgentId) ?? detail.team.name : detail.team.name,
          action: `Task ${task.status}`,
          summary: task.title,
          status: taskStatusToTone(task.status),
          tokenUsage: 0,
          createdAt: task.updatedAt,
        }));
        return [...heartbeats, ...tasks];
      });
      setActivity(items.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

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
      <div className="p-8">
        <LoadingState label="Streaming agent activity..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadActivity()} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agent Activity Feed</h1>
            <p className="mt-1 text-sm text-gray-500">
              Live stream of heartbeats, task updates, and runtime signals from the control plane.
            </p>
          </div>
          <Link
            to="/agents/my"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Manage deployments
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-2xl border border-gray-200 pl-9 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Filter activity..."
              />
            </div>
            <div className="flex gap-2">
              {(["all", "success", "warning", "info"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setStatus(value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    status === value
                      ? "bg-slate-900 text-white"
                      : "border border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filtered.map((item) => {
            const borderTone =
              item.status === "success"
                ? "border-l-teal-500"
                : item.status === "warning"
                ? "border-l-orange-500"
                : "border-l-indigo-500";
            return (
              <article
                key={item.id}
                className={`animate-slide-in-down rounded-3xl border border-gray-200 border-l-4 ${borderTone} bg-white p-4 shadow-sm`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      {statusIcon(item.status)}
                      <span>{item.agentName}</span>
                      <span className="font-normal text-gray-400">·</span>
                      <span className="font-normal text-gray-600">{item.action}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{item.summary}</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="font-mono text-sm font-medium text-gray-700">{item.tokenUsage.toLocaleString()} tok</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              </article>
            );
          })}

          {filtered.length === 0 ? (
            <EmptyState
              title={activity.length === 0 ? "No activity yet" : "No activity matches this filter"}
              description="Heartbeats and task transitions will appear here once control-plane teams are deployed and running."
              ctaLabel="Deploy an agent"
              ctaTo="/agents"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
