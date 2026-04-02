import { useState } from "react";
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
} from "lucide-react";

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

const MOCK_RUNS: RunLog[] = [
  {
    id: "run-abc123",
    workflowName: "Customer Support Pipeline",
    status: "failed",
    startedAt: "2026-04-01T20:00:00Z",
    durationMs: 4320,
    steps: [
      {
        stepId: "step-1",
        stepName: "Classify Intent",
        kind: "llm",
        status: "success",
        durationMs: 850,
        startedAt: "2026-04-01T20:00:00Z",
        input: { message: "My order hasn't arrived yet" },
        output: { intent: "shipping_inquiry", confidence: 0.97 },
      },
      {
        stepId: "step-2",
        stepName: "Fetch Order Status",
        kind: "action",
        status: "success",
        durationMs: 210,
        startedAt: "2026-04-01T20:00:00.850Z",
        input: { intent: "shipping_inquiry", customerId: "cust-9988" },
        output: { orderId: "ORD-442", status: "in_transit", eta: "2026-04-03" },
      },
      {
        stepId: "step-3",
        stepName: "Generate Response",
        kind: "llm",
        status: "failure",
        durationMs: 3260,
        startedAt: "2026-04-01T20:00:01.060Z",
        input: { orderId: "ORD-442", status: "in_transit", eta: "2026-04-03" },
        output: {},
        error: "LLM provider timeout: request exceeded 3000ms limit",
        aiExplanation:
          "The LLM step timed out because the provider response took longer than the configured 3-second threshold. This is likely due to a momentary spike in provider latency. Consider increasing the timeout setting on this step to 5000ms, or adding a retry with exponential backoff.",
      },
    ],
  },
  {
    id: "run-def456",
    workflowName: "Invoice Processing",
    status: "completed",
    startedAt: "2026-04-01T18:30:00Z",
    durationMs: 1890,
    steps: [
      {
        stepId: "step-a",
        stepName: "Parse Invoice",
        kind: "transform",
        status: "success",
        durationMs: 120,
        startedAt: "2026-04-01T18:30:00Z",
        input: { fileUrl: "s3://invoices/inv-2890.pdf" },
        output: { vendor: "Acme Supplies", amount: 12500, currency: "USD" },
      },
      {
        stepId: "step-b",
        stepName: "Validate Amount",
        kind: "condition",
        status: "success",
        durationMs: 20,
        startedAt: "2026-04-01T18:30:00.120Z",
        input: { amount: 12500 },
        output: { requiresApproval: true },
      },
      {
        stepId: "step-c",
        stepName: "Request Approval",
        kind: "approval",
        status: "skipped",
        durationMs: 0,
        startedAt: "2026-04-01T18:30:00.140Z",
        input: { requiresApproval: true },
        output: { skipped: true, reason: "Below auto-approve threshold override" },
      },
      {
        stepId: "step-d",
        stepName: "Post to Accounting",
        kind: "action",
        status: "success",
        durationMs: 1750,
        startedAt: "2026-04-01T18:30:00.140Z",
        input: { vendor: "Acme Supplies", amount: 12500 },
        output: { journalEntryId: "JE-8821", posted: true },
      },
    ],
  },
  {
    id: "run-live",
    workflowName: "Research Assistant",
    status: "running",
    startedAt: new Date(Date.now() - 5000).toISOString(),
    durationMs: 0,
    steps: [
      {
        stepId: "step-x",
        stepName: "Fetch Sources",
        kind: "mcp",
        status: "success",
        durationMs: 430,
        startedAt: new Date(Date.now() - 5000).toISOString(),
        input: { query: "AI agent frameworks 2026" },
        output: { sources: 12, topResult: "arxiv.org/abs/2601.xxxxx" },
      },
      {
        stepId: "step-y",
        stepName: "Synthesize Report",
        kind: "llm",
        status: "running",
        durationMs: 0,
        startedAt: new Date(Date.now() - 4500).toISOString(),
        input: { sources: 12 },
        output: {},
      },
    ],
  },
];

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle size={15} className="text-green-500" />,
  failure: <XCircle size={15} className="text-red-500" />,
  skipped: <SkipForward size={15} className="text-gray-400" />,
  running: <Loader size={15} className="text-brand-teal animate-spin" />,
};

const RUN_STATUS_CONFIG = {
  completed: { color: "bg-green-100 text-green-700", label: "Completed" },
  failed: { color: "bg-red-100 text-red-700", label: "Failed" },
  running: { color: "bg-brand-teal/10 text-brand-teal", label: "Live" },
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
                      onClick={(e) => { e.stopPropagation(); setShowExplanation(true); }}
                      className="flex items-center gap-1.5 text-xs text-brand-primary hover:text-brand-primary-hover font-medium"
                    >
                      <Lightbulb size={12} />
                      Explain Error with AI
                    </button>
                  ) : (
                    <div className="mt-2 p-3 bg-brand-primary-light border border-brand-primary/20 rounded-lg">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-brand-primary mb-1.5">
                        <Brain size={12} />
                        AI Explanation
                      </div>
                      <p className="text-xs text-brand-navy leading-relaxed">{step.aiExplanation}</p>
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
          <Radio size={15} className="text-brand-teal animate-pulse" />
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
  const [filter, setFilter] = useState<"all" | "failed" | "running">("all");

  const filtered = MOCK_RUNS.filter((r) => {
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
          <span className="px-2 py-0.5 rounded-full bg-brand-primary-light text-brand-primary text-xs font-medium">
            In Development
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
            <Radio size={10} className="animate-pulse" />
            Live
          </span>
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
        {filtered.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No runs to show</p>
          </div>
        )}
      </div>
    </div>
  );
}
