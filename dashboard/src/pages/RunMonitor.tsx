import { useState, useEffect } from "react";
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
} from "lucide-react";
import { MOCK_RUNS } from "../data/mockData";
import { StatusBadge } from "../components/StatusBadge";
import type { WorkflowRun, StepResult } from "../types/workflow";
import clsx from "clsx";

const POLL_INTERVAL_MS = 3000;

export default function RunMonitor() {
  const [runs, setRuns] = useState<WorkflowRun[]>(() =>
    [...MOCK_RUNS].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(MOCK_RUNS.filter((r) => r.status === "running").map((r) => r.id))
  );
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  // Poll for updates — re-reads the shared MOCK_RUNS array on each tick
  useEffect(() => {
    const id = setInterval(() => {
      setRuns(
        [...MOCK_RUNS].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )
      );
      setLastRefreshed(new Date());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleRefresh() {
    setRuns(
      [...MOCK_RUNS].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )
    );
    setLastRefreshed(new Date());
  }

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
  const recentRuns = runs.filter((r) => r.status !== "running" && r.status !== "pending");

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Run Monitor</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Live view of active workflow runs · auto-refreshes every {POLL_INTERVAL_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            Last updated: {lastRefreshed.toLocaleTimeString()}
          </span>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Active runs */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Active Runs ({activeRuns.length})
        </h2>

        {activeRuns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={22} className="text-green-500" />
            </div>
            <p className="text-gray-600 font-medium">No active runs</p>
            <p className="text-gray-400 text-sm mt-1">
              Start a workflow from the{" "}
              <Link to="/builder" className="text-blue-600 hover:underline">
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
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Recently Completed ({recentRuns.length})
        </h2>
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
      </section>
    </div>
  );
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 shrink-0">
          <Workflow size={18} className="text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-gray-900 truncate">{run.templateName}</p>
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
                run.status === "failed" ? "bg-red-400" : "bg-blue-500"
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="shrink-0 text-gray-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

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
  const hasOutput = Object.keys(step.output).length > 0;

  const icon = {
    success: <CheckCircle2 size={15} className="text-green-500" />,
    failure: <XCircle size={15} className="text-red-500" />,
    skipped: <SkipForward size={15} className="text-gray-400" />,
    running: <Loader2 size={15} className="text-yellow-500 animate-spin" />,
  }[step.status];

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center shrink-0 mt-0.5">
        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500 font-medium">
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
          {hasOutput && step.status !== "running" && (
            <button
              onClick={() => setShowOutput((v) => !v)}
              className="ml-auto text-xs text-blue-600 hover:underline"
            >
              {showOutput ? "hide output" : "show output"}
            </button>
          )}
        </div>

        {step.error && (
          <p className="mt-1 text-xs text-red-600">{step.error}</p>
        )}

        {showOutput && hasOutput && (
          <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
