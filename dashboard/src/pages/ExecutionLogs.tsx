import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  XCircle,
  SkipForward,
  Loader,
  ChevronDown,
  ChevronRight,
  Zap,
  Clock,
  Brain,
  Lightbulb,
  Radio,
  RefreshCw,
} from "lucide-react";
import { listRuns } from "../api/client";
import type { StepResult, WorkflowRun } from "../types/workflow";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

interface StepLog {
  stepId: string;
  stepName: string;
  kind: string;
  status: "success" | "failure" | "skipped" | "running";
  durationMs: number;
  startedAt?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  aiExplanation?: string;
}

interface RunLog {
  id: string;
  workflowName: string;
  status: "completed" | "failed" | "running";
  startedAt: string;
  durationMs: number;
  steps: StepLog[];
}

const POLL_INTERVAL_MS = 3000;

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle size={15} className="text-green-500" />,
  failure: <XCircle size={15} className="text-red-500" />,
  skipped: <SkipForward size={15} className="text-gray-400" />,
  running: <Loader size={15} className="text-blue-500 animate-spin" />,
};

const RUN_STATUS_CONFIG = {
  completed: { color: "bg-green-100 text-green-700", label: "Completed" },
  failed: { color: "bg-red-100 text-red-700", label: "Failed" },
  running: { color: "bg-blue-100 text-blue-700", label: "Live" },
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function mapStepKind(step: StepResult): string {
  if (step.stepId.includes("approval")) return "approval";
  if (step.stepId.includes("mcp")) return "mcp";
  return "step";
}

function mapRunToLog(run: WorkflowRun): RunLog {
  const status: RunLog["status"] =
    run.status === "failed"
      ? "failed"
      : run.status === "running" || run.status === "pending"
        ? "running"
        : "completed";

  const durationMs = run.completedAt
    ? Math.max(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(), 0)
    : 0;

  return {
    id: run.id,
    workflowName: run.templateName,
    status,
    startedAt: run.startedAt,
    durationMs,
    steps: run.stepResults.map((step) => ({
      stepId: step.stepId,
      stepName: step.stepName,
      kind: mapStepKind(step),
      status: step.status,
      durationMs: step.durationMs,
      input: {},
      output: step.output ?? {},
      error: step.error,
      aiExplanation: step.error
        ? "Inspect this step output and provider configuration to determine root cause."
        : undefined,
    })),
  };
}

function StepRow({ step }: { step: StepLog }) {
  const [expanded, setExpanded] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div
        onClick={() => setExpanded((e) => !e)}
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition ${
          step.status === "failure" ? "bg-red-50" : "bg-white"
        }`}
      >
        {STATUS_ICON[step.status]}
        <span className="flex-1 text-sm font-medium text-gray-800">{step.stepName}</span>
        <span className="text-xs text-gray-400 font-mono">{step.kind}</span>
        <span className="text-xs text-gray-400 w-16 text-right">{formatDuration(step.durationMs)}</span>
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
          {step.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-xs font-medium text-red-700 mb-1">Error</p>
              <p className="text-xs text-red-600 font-mono">{step.error}</p>

              {step.aiExplanation && (
                <div className="mt-3">
                  {!showExplanation ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowExplanation(true);
                      }}
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Lightbulb size={12} />
                      Explain Error with AI
                    </button>
                  ) : (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-1.5">
                        <Brain size={12} />
                        AI Explanation
                      </div>
                      <p className="text-xs text-blue-800 leading-relaxed">{step.aiExplanation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-400 mb-1">Input</p>
              <pre className="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-x-auto font-mono">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Output</p>
              <pre className="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-x-auto font-mono">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: RunLog }) {
  const [expanded, setExpanded] = useState(run.status === "running");
  const cfg = RUN_STATUS_CONFIG[run.status];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-gray-50 transition"
      >
        {run.status === "running" && <Radio size={15} className="text-blue-500 animate-pulse" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{run.workflowName}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            <span className="font-mono">{run.id}</span>
            <span>·</span>
            <Clock size={10} />
            <span>{timeAgo(run.startedAt)}</span>
            {run.durationMs > 0 && (
              <>
                <span>·</span>
                <Zap size={10} />
                <span>{formatDuration(run.durationMs)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {run.steps.map((s) => (
              <span key={s.stepId} title={s.stepName}>
                {STATUS_ICON[s.status]}
              </span>
            ))}
          </div>
          {expanded ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronRight size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-6 py-4 space-y-2">
          {run.steps.map((step) => (
            <StepRow key={step.stepId} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutionLogs() {
  const { getAccessToken } = useAuth();
  const [filter, setFilter] = useState<"all" | "failed" | "running">("all");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  async function fetchRuns(silent = false) {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const accessToken = await getAccessToken() ?? undefined;
      const fetched = await listRuns(undefined, accessToken);
      const sorted = [...fetched].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      setRuns(sorted);
      setLastRefreshed(new Date());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load execution logs");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchRuns();
    const interval = window.setInterval(() => {
      void fetchRuns(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    const normalized: RunLog[] = runs.map((run) => mapRunToLog(run));
    return normalized.filter((r) => {
      if (filter === "failed") return r.status === "failed";
      if (filter === "running") return r.status === "running";
      return true;
    });
  }, [filter, runs]);

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading execution logs..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8">
        <ErrorState
          title="Execution logs unavailable"
          message={loadError}
          onRetry={() => {
            void fetchRuns();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Execution Logs</h1>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                <Radio size={10} className="animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">Step-by-step execution traces with automatic refresh.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Last updated: {lastRefreshed.toLocaleTimeString()}</span>
            <button
              onClick={() => {
                void fetchRuns();
              }}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex gap-1 mt-5">
          {(["all", "failed", "running"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition ${
                filter === f ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-6 space-y-4">
        {filtered.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
        {filtered.length === 0 && (
          <EmptyState
            title="No runs to show"
            description="Try a different filter or start a new run from the workflow builder."
            ctaLabel="Open builder"
            ctaTo="/builder"
          />
        )}
      </div>
    </div>
  );
}
