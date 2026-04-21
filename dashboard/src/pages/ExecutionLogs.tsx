import { useEffect, useState } from "react";
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
import { debugStep, listRuns } from "../api/client";
import type { StepResult, WorkflowRun } from "../types/workflow";
import { useAuth } from "../context/AuthContext";

interface StepLog {
  stepId: string;
  stepName: string;
  kind: string;
  status: "success" | "failure" | "skipped" | "running";
  durationMs: number;
  startedAt: string;
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
  if (ms === 0) return "—";
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

function toStepLog(step: StepResult, startedAt: string): StepLog {
  const output = step.output ?? {};
  return {
    stepId: step.stepId,
    stepName: step.stepName,
    kind: typeof output.kind === "string" ? output.kind : "step",
    status: step.status,
    durationMs: step.durationMs,
    startedAt,
    input: typeof output.input === "object" && output.input !== null ? (output.input as Record<string, unknown>) : {},
    output: typeof output.output === "object" && output.output !== null ? (output.output as Record<string, unknown>) : output,
    error: step.error,
  };
}

function toRunLog(run: WorkflowRun): RunLog {
  return {
    id: run.id,
    workflowName: run.templateName,
    status: run.status === "running" ? "running" : run.status === "failed" ? "failed" : "completed",
    startedAt: run.startedAt,
    durationMs:
      run.completedAt != null
        ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
        : 0,
    steps: run.stepResults.map((step) => toStepLog(step, run.startedAt)),
  };
}

function StepRow({ step }: { step: StepLog }) {
  const [expanded, setExpanded] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [explanation, setExplanation] = useState(step.aiExplanation ?? "");
  const [debugging, setDebugging] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);

  async function handleExplain(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setShowExplanation(true);
    if (explanation || !step.error) return;

    setDebugging(true);
    setDebugError(null);
    try {
      const result = await debugStep(step.stepId, step.error, step.output);
      setExplanation(result.explanation);
    } catch (err) {
      setDebugError(err instanceof Error ? err.message : "Failed to generate explanation");
    } finally {
      setDebugging(false);
    }
  }

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

              {step.error && (
                <div className="mt-3">
                  {!showExplanation ? (
                    <button
                      onClick={handleExplain}
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
                      {debugging ? (
                        <p className="text-xs text-blue-800 leading-relaxed">Generating explanation…</p>
                      ) : debugError ? (
                        <p className="text-xs text-red-700 leading-relaxed">{debugError}</p>
                      ) : explanation ? (
                        <p className="text-xs text-blue-800 leading-relaxed">{explanation}</p>
                      ) : (
                        <p className="text-xs text-blue-800 leading-relaxed">
                          No explanation available for this step.
                        </p>
                      )}
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
        {run.status === "running" && (
          <Radio size={15} className="text-blue-500 animate-pulse" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{run.workflowName}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
              {cfg.label}
            </span>
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
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setLoading(true);
      setLoadError(null);
      try {
        const accessToken = await getAccessToken() ?? undefined;
        const fetchedRuns = await listRuns(undefined, accessToken);
        if (!cancelled) {
          setRuns(fetchedRuns.map(toRunLog));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load execution logs");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const filtered = runs.filter((r) => {
    if (filter === "failed") return r.status === "failed";
    if (filter === "running") return r.status === "running";
    return true;
  });

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Execution Logs</h1>
          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
            Live Data
          </span>
          {runs.some((run) => run.status === "running") ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
              <Radio size={10} className="animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
        <p className="text-gray-500 text-sm mt-1">
          Step-by-step execution traces with AI-powered error explanations.
        </p>

        <div className="flex gap-1 mt-5">
          {(["all", "failed", "running"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition ${
                filter === f
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-6 space-y-4">
        {loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <RefreshCw size={18} className="animate-spin mr-2" />
            Loading execution logs…
          </div>
        ) : null}
        {filtered.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {runs.length === 0 ? "No execution logs are available yet." : "No runs match this filter."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
