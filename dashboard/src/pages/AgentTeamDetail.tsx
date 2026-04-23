import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bot, Clock3, RefreshCw, Workflow } from "lucide-react";
import {
  getControlPlaneTeam,
  type ControlPlaneAgent,
  type ControlPlaneHeartbeatRecord,
  type ControlPlaneTask,
  type ControlPlaneTeamDetail,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ErrorState, LoadingState } from "../components/UiStates";
import clsx from "clsx";

const POLL_INTERVAL_MS = 5000;

export default function AgentTeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const [searchParams] = useSearchParams();
  const { getAccessToken } = useAuth();
  const [detail, setDetail] = useState<ControlPlaneTeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const highlightedAgentId = searchParams.get("agent");

  const loadTeam = useCallback(async (silent = false) => {
    if (!teamId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const payload = await getControlPlaneTeam(teamId, accessToken);
      setDetail(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load deployed team");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getAccessToken, teamId]);

  useEffect(() => {
    void loadTeam();
    const intervalId = window.setInterval(() => {
      void loadTeam(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadTeam]);

  const heartbeatByAgentId = useMemo(() => {
    const mapping = new Map<string, ControlPlaneHeartbeatRecord>();
    if (!detail) return mapping;
    for (const heartbeat of detail.heartbeats) {
      const current = mapping.get(heartbeat.agentId);
      if (!current || current.startedAt < heartbeat.startedAt) {
        mapping.set(heartbeat.agentId, heartbeat);
      }
    }
    return mapping;
  }, [detail]);

  const tasksByAgentId = useMemo(() => {
    const mapping = new Map<string, ControlPlaneTask[]>();
    if (!detail) return mapping;
    for (const task of detail.tasks) {
      if (!task.assignedAgentId) continue;
      const bucket = mapping.get(task.assignedAgentId) ?? [];
      bucket.push(task);
      mapping.set(task.assignedAgentId, bucket);
    }
    return mapping;
  }, [detail]);

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading deployed team..." />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8">
        <ErrorState
          title="Team monitor unavailable"
          message={error ?? "The deployed team could not be found."}
          onRetry={() => {
            void loadTeam();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/monitor"
            className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800 dark:text-surface-400 dark:hover:text-surface-100"
          >
            <ArrowLeft size={14} />
            Back to monitor
          </Link>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">
              Deployed Agent Team
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-surface-50">
              {detail.team.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-surface-400">
              {detail.team.description || "Workflow-derived agent team ready for monitoring and handoff review."}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            void loadTeam();
          }}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Deployment Mode" value={detail.team.deploymentMode.replace("_", " ")} />
        <StatCard label="Agents" value={String(detail.agents.length)} />
        <StatCard label="Open Tasks" value={String(detail.tasks.filter((task) => task.status !== "done").length)} />
        <StatCard label="Budget" value={`$${detail.team.budgetMonthlyUsd.toFixed(2)}`} />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-surface-50">Agent roster</h2>
            <p className="text-sm text-slate-500 dark:text-surface-400">
              Workflow step mapping, heartbeat health, and current workload.
            </p>
          </div>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
            Auto-refresh {POLL_INTERVAL_MS / 1000}s
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {detail.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              heartbeat={heartbeatByAgentId.get(agent.id)}
              tasks={tasksByAgentId.get(agent.id) ?? []}
              highlighted={highlightedAgentId === agent.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-surface-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-surface-50">{value}</p>
    </div>
  );
}

function AgentCard({
  agent,
  heartbeat,
  tasks,
  highlighted,
}: {
  agent: ControlPlaneAgent;
  heartbeat?: ControlPlaneHeartbeatRecord;
  tasks: ControlPlaneTask[];
  highlighted: boolean;
}) {
  const openTasks = tasks.filter((task) => task.status !== "done");

  return (
    <article
      className={clsx(
        "rounded-[24px] border p-5 shadow-sm transition",
        highlighted
          ? "border-indigo-400 bg-indigo-50/70 dark:border-brand-500 dark:bg-brand-500/10"
          : "border-slate-200 bg-slate-50/60 dark:border-surface-800 dark:bg-surface-950/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <Bot size={18} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-surface-50">{agent.name}</h3>
              <StatusPill tone={agent.status === "active" ? "teal" : agent.status === "paused" ? "amber" : "rose"}>
                {agent.status}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-surface-500">
              {agent.roleKey}
            </p>
          </div>
        </div>
        <StatusPill tone={heartbeatTone(heartbeat?.status)}>
          {heartbeat?.status ?? "no heartbeat"}
        </StatusPill>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <InlineMetric label="Workflow step" value={agent.workflowStepKind ?? "manager"} icon={<Workflow size={12} />} />
        <InlineMetric label="Schedule" value={formatSchedule(agent)} icon={<Clock3 size={12} />} />
        <InlineMetric label="Budget" value={`$${agent.budgetMonthlyUsd.toFixed(2)}`} icon={<Bot size={12} />} />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-surface-300">
        {agent.instructions}
      </p>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-surface-500">
          Current queue
        </p>
        {openTasks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-surface-400">No open tasks assigned.</p>
        ) : (
          openTasks.slice(0, 3).map((task) => (
            <div
              key={task.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-surface-800 dark:bg-surface-900"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-900 dark:text-surface-50">{task.title}</span>
                <StatusPill tone={task.status === "done" ? "teal" : task.status === "blocked" ? "rose" : "amber"}>
                  {task.status.replace("_", " ")}
                </StatusPill>
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function InlineMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-surface-800 dark:bg-surface-900">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-surface-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-surface-50">{value}</p>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "teal" | "amber" | "rose" | "slate";
}) {
  const palette = {
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-surface-800 dark:text-surface-300",
  } as const;

  return (
    <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold capitalize", palette[tone])}>
      {children}
    </span>
  );
}

function formatSchedule(agent: ControlPlaneAgent): string {
  if (agent.schedule.type === "interval") {
    return `${agent.schedule.intervalMinutes ?? 0} min`;
  }
  if (agent.schedule.type === "cron") {
    return agent.schedule.cronExpression ?? "cron";
  }
  return "manual";
}

function heartbeatTone(
  status?: ControlPlaneHeartbeatRecord["status"]
): "teal" | "amber" | "rose" | "slate" {
  if (status === "completed") return "teal";
  if (status === "running" || status === "queued") return "amber";
  if (status === "blocked") return "rose";
  return "slate";
}
