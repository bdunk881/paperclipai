import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  Loader2,
  Workflow,
  Sparkles,
  Bot,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import {
  debugStep,
  getControlPlaneTeam,
  listControlPlaneTeams,
  listRuns,
  type ControlPlaneTeamDetail,
} from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { WorkflowRun, StepResult, AgentSlotResult } from "../types/workflow";
import clsx from "clsx";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 3000;

export default function RunMonitor() {
  const { requireAccessToken } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamDetails, setTeamDetails] = useState<ControlPlaneTeamDetail[]>([]);

  const fetchRuns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const accessToken = await requireAccessToken();
      const [runResults, teams] = await Promise.all([
        listRuns(undefined, accessToken),
        listControlPlaneTeams(accessToken),
      ]);
      const fetched = [...runResults].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      const fetchedTeamDetails = await Promise.all(
        [...teams]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 4)
          .map(async (team) => getControlPlaneTeam(team.id, accessToken))
      );
      setRuns(fetched);
      setTeamDetails(fetchedTeamDetails);
      setLastRefreshed(new Date());
      // Auto-expand any newly running runs
      setExpandedIds((prev) => {
        const next = new Set(prev);
        fetched.filter((r) => r.status === "running" || r.status === "pending").forEach((r) => next.add(r.id));
        return next;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load runs");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void fetchRuns();
    const id = setInterval(() => { void fetchRuns(true); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchRuns]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleRefresh() {
    void fetchRuns();
  }

  const activeRuns = runs.filter(
    (r) => r.status === "running" || r.status === "pending" || r.status === "awaiting_approval"
  );
  const recentRuns = runs.filter(
    (r) => r.status !== "running" && r.status !== "pending" && r.status !== "awaiting_approval"
  );

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading run monitor..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8">
        <ErrorState
          title="Run monitor unavailable"
          message={loadError}
          onRetry={() => {
            void fetchRuns();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Run Monitor</h1>
          <p className="text-gray-500 dark:text-surface-400 mt-1 text-sm">
            Live view of active workflow runs · auto-refreshes every {POLL_INTERVAL_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            Last updated: {lastRefreshed.toLocaleTimeString()}
          </span>
          <button
            onClick={handleRefresh}
            aria-label="Refresh run monitor"
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Active runs */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-surface-400 uppercase tracking-wide mb-4">
          Agent Teams ({teamDetails.length})
        </h2>

        {teamDetails.length === 0 ? (
          <div className="bg-white dark:bg-surface-900 rounded-xl border border-gray-200 dark:border-surface-800 p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-3">
              <Bot size={22} className="text-brand-500" />
            </div>
            <p className="text-gray-600 font-medium">No deployed teams yet</p>
            <p className="text-gray-400 text-sm mt-1">
              Deploy a workflow from the builder to start monitoring agent rosters here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {teamDetails.map((detail) => (
              <TeamMonitorCard key={detail.team.id} detail={detail} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-surface-400 uppercase tracking-wide mb-4">
          Active Runs ({activeRuns.length})
        </h2>

        {activeRuns.length === 0 ? (
          <div className="bg-white dark:bg-surface-900 rounded-xl border border-gray-200 dark:border-surface-800 p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={22} className="text-green-500" />
            </div>
            <p className="text-gray-600 font-medium">No active runs</p>
            <p className="text-gray-400 text-sm mt-1">
              Start a workflow from the{" "}
              <Link to="/builder" className="text-brand-600 hover:underline">
                builder
              </Link>{" "}
              to see it here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                expanded={expandedIds.has(run.id)}
                onToggle={() => toggleExpand(run.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent completed/failed */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-surface-400 uppercase tracking-wide mb-4">
          Recently Completed ({recentRuns.length})
        </h2>
        {recentRuns.length === 0 ? (
          <EmptyState
            title="No completed runs yet"
            description="Once runs complete, you will see execution details and failure insights here."
            ctaLabel="Start a run"
            ctaTo="/builder"
          />
        ) : (
          <div className="space-y-3">
            {recentRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                expanded={expandedIds.has(run.id)}
                onToggle={() => toggleExpand(run.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TeamMonitorCard({ detail }: { detail: ControlPlaneTeamDetail }) {
  const openTasks = detail.tasks.filter((task) => task.status !== "done").length;
  const latestHeartbeat = detail.heartbeats
    .slice()
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];

  return (
    <div className="overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900">
      <div className="border-b border-gray-100 px-5 py-4 dark:border-surface-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{detail.team.name}</h3>
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                {detail.team.deploymentMode.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-surface-400">
              {detail.team.workflowTemplateName ?? "Custom workflow deployment"}
            </p>
          </div>
          <Link
            to={`/agents/team/${detail.team.id}`}
            className="text-sm font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Open team
          </Link>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-3">
        <MonitorMetric label="Agents" value={String(detail.agents.length)} />
        <MonitorMetric label="Open tasks" value={String(openTasks)} />
        <MonitorMetric
          label="Latest heartbeat"
          value={latestHeartbeat ? latestHeartbeat.status : "none"}
          tone={latestHeartbeat ? heartbeatTone(latestHeartbeat.status) : "slate"}
        />
      </div>

      <div className="border-t border-gray-100 px-5 py-4 dark:border-surface-800">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-surface-500">
          Agent roster
        </p>
        <div className="space-y-2">
          {detail.agents.slice(0, 4).map((agent) => {
            const heartbeat = detail.heartbeats
              .filter((entry) => entry.agentId === agent.id)
              .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];

            return (
              <Link
                key={agent.id}
                to={`/agents/team/${detail.team.id}?agent=${encodeURIComponent(agent.id)}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-surface-800 dark:bg-surface-950/40 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bot size={14} className="text-brand-500" />
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {agent.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-gray-400 dark:text-surface-500">
                    {agent.roleKey}
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize",
                    heartbeatToneClasses(heartbeatTone(heartbeat?.status))
                  )}
                >
                  {heartbeat?.status ?? agent.status}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonitorMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "teal" | "amber" | "rose" | "slate";
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-surface-500">
        {label}
      </p>
      <p className={clsx("mt-2 text-sm font-semibold capitalize", heartbeatTextTone(tone))}>{value}</p>
    </div>
  );
}

function heartbeatTone(status?: ControlPlaneTeamDetail["heartbeats"][number]["status"] | string) {
  if (status === "completed" || status === "active") return "teal";
  if (status === "running" || status === "queued" || status === "in_progress") return "amber";
  if (status === "blocked" || status === "terminated" || status === "failed") return "rose";
  return "slate";
}

function heartbeatToneClasses(tone: "teal" | "amber" | "rose" | "slate") {
  return {
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-surface-800 dark:text-surface-300",
  }[tone];
}

function heartbeatTextTone(tone: "teal" | "amber" | "rose" | "slate") {
  return {
    teal: "text-teal-700 dark:text-teal-300",
    amber: "text-amber-700 dark:text-amber-300",
    rose: "text-rose-700 dark:text-rose-300",
    slate: "text-gray-900 dark:text-gray-100",
  }[tone];
}

function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: WorkflowRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const duration = run.completedAt
    ? Math.round(
        (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
      )
    : Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000);

  const completedSteps = run.stepResults.filter((s) => s.status === "success").length;
  const totalSteps = run.stepResults.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className="bg-white dark:bg-surface-900 rounded-xl border border-gray-200 dark:border-surface-800 overflow-hidden">
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-50 shrink-0">
          <Workflow size={18} className="text-brand-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{run.templateName}</p>
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>ID: {run.id}</span>
            <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {duration}s
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-32 shrink-0">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{completedSteps}/{totalSteps} steps</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-500",
                run.status === "failed" ? "bg-red-400" : "bg-brand-500"
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="shrink-0 text-gray-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Awaiting approval banner — always visible */}
      {run.status === "awaiting_approval" && (
        <div className="border-t border-yellow-200 bg-yellow-50 px-5 py-3 flex items-center gap-3">
          <UserCheck size={16} className="text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800 font-medium flex-1">
            Run paused — waiting for human approval
          </p>
          <Link
            to="/approvals"
            className="text-xs px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white font-medium transition"
          >
            Review in Approvals →
          </Link>
        </div>
      )}

      {/* Step breakdown */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          {run.error && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <span>{run.error}</span>
            </div>
          )}

          <div className="space-y-2">
            {run.stepResults.map((step, idx) => (
              <StepRow key={step.stepId} step={step} index={idx + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: StepResult; index: number }) {
  const [showOutput, setShowOutput] = useState(false);
  const [debugResult, setDebugResult] = useState<{ explanation: string; suggestion: string } | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const hasOutput = Object.keys(step.output).length > 0;

  const icon = {
    success: <CheckCircle2 size={15} className="text-green-500" />,
    failure: <XCircle size={15} className="text-red-500" />,
    skipped: <SkipForward size={15} className="text-gray-400" />,
    running: <Loader2 size={15} className="text-yellow-500 animate-spin" />,
  }[step.status];

  async function handleDebug() {
    setDebugLoading(true);
    setDebugError(null);
    setDebugResult(null);
    try {
      const result = await debugStep(step.stepId, step.error ?? "", step.output);
      setDebugResult(result);
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : "Debug failed");
    } finally {
      setDebugLoading(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center shrink-0 mt-0.5">
        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500 dark:text-surface-400 font-medium">
          {index}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <span
            className={clsx(
              "text-sm font-medium",
              step.status === "skipped" ? "text-gray-400" : "text-gray-800"
            )}
          >
            {step.stepName}
          </span>
          {step.durationMs > 0 && (
            <span className="text-xs text-gray-400">{step.durationMs}ms</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step.status === "failure" && !debugResult && (
              <button
                onClick={handleDebug}
                disabled={debugLoading}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition disabled:opacity-50"
              >
                {debugLoading ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} />
                )}
                {debugLoading ? "Analyzing…" : "Debug with AI"}
              </button>
            )}
            {hasOutput && step.status !== "running" && (
              <button
                onClick={() => setShowOutput((v) => !v)}
                className="text-xs text-brand-600 hover:underline"
              >
                {showOutput ? "hide output" : "show output"}
              </button>
            )}
          </div>
        </div>

        {step.error && (
          <p className="mt-1 text-xs text-red-600">{step.error}</p>
        )}

        {debugError && (
          <p className="mt-1 text-xs text-red-500">{debugError}</p>
        )}

        {debugResult && (
          <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700">
              <Sparkles size={12} />
              AI Debugger
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700 mb-0.5">What happened</p>
              <p className="text-xs text-gray-600 leading-relaxed">{debugResult.explanation}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700 mb-0.5">Suggested fix</p>
              <p className="text-xs text-gray-600 leading-relaxed">{debugResult.suggestion}</p>
            </div>
            <button
              onClick={() => setDebugResult(null)}
              className="text-xs text-purple-500 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {step.agentSlotResults && step.agentSlotResults.length > 0 && (
          <AgentSlotPanel slots={step.agentSlotResults} />
        )}

        {showOutput && hasOutput && (
          <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 dark:border-surface-800 rounded-lg p-3 overflow-x-auto text-gray-700">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentSlotPanel — per-slot status grid + message log for agent steps
// ---------------------------------------------------------------------------

function AgentSlotPanel({ slots }: { slots: AgentSlotResult[] }) {
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  const slotStatusIcon = (s: AgentSlotResult["status"]) =>
    ({
      success: <CheckCircle2 size={12} className="text-green-500" />,
      failure: <XCircle size={12} className="text-red-500" />,
      running: <Loader2 size={12} className="text-yellow-500 animate-spin" />,
    })[s];

  return (
    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 mb-2">
        <Bot size={12} />
        Agent Workers ({slots.length} slot{slots.length !== 1 ? "s" : ""})
      </div>

      {/* Slot grid */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(slots.length, 4)}, 1fr)` }}>
        {slots.map((slot) => (
          <button
            key={slot.slotIndex}
            onClick={() => setExpandedSlot((prev) => (prev === slot.slotIndex ? null : slot.slotIndex))}
            className={clsx(
              "flex flex-col items-start gap-1 p-2 rounded-md border text-left transition",
              slot.status === "success"
                ? "bg-white dark:bg-surface-900 border-green-200 hover:border-green-400"
                : slot.status === "failure"
                ? "bg-red-50 border-red-200 hover:border-red-400"
                : "bg-white dark:bg-surface-900 border-yellow-200 hover:border-yellow-400"
            )}
          >
            <div className="flex items-center gap-1 text-xs font-medium text-gray-700">
              {slotStatusIcon(slot.status)}
              W{slot.slotIndex}
            </div>
            <span className="text-xs text-gray-400">{slot.durationMs}ms</span>
            {slot.messages.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-indigo-500">
                <MessageSquare size={10} />
                {slot.messages.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Expanded slot detail */}
      {expandedSlot !== null && (() => {
        const slot = slots.find((s) => s.slotIndex === expandedSlot);
        if (!slot) return null;
        return (
          <div className="mt-2 space-y-2">
            {slot.error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {slot.error}
              </p>
            )}

            {Object.keys(slot.output).length > 0 && (
              <pre className="text-xs bg-white dark:bg-surface-900 border border-indigo-200 rounded p-2 overflow-x-auto text-gray-700">
                {JSON.stringify(slot.output, null, 2)}
              </pre>
            )}

            {slot.messages.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-indigo-600">Message Log</p>
                {slot.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={clsx(
                      "text-xs px-2 py-1 rounded",
                      msg.from === "manager"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-white dark:bg-surface-900 border border-indigo-200 text-gray-700"
                    )}
                  >
                    <span className="font-medium capitalize mr-1">{msg.from}→</span>
                    {msg.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
