import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import "./RunAuditSidebar.css";
import {
  AlertCircle,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  SkipForward,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { StepResult, WorkflowRun } from "../types/workflow";
import { buildWorkflowBuilderRoute } from "../utils/workflowBuilderRoute";

type StepStatus = StepResult["status"];

const STEP_STATUS_META: Record<
  StepStatus,
  { label: string; dot: string; glow: string; icon: LucideIcon; iconClass: string }
> = {
  success: {
    label: "Success",
    dot: "bg-accent-teal",
    glow: "shadow-[0_0_24px_rgba(20,184,166,0.28)]",
    icon: CheckCircle2,
    iconClass: "text-accent-teal",
  },
  running: {
    label: "Running",
    dot: "bg-brand-500",
    glow: "shadow-[0_0_24px_rgba(99,102,241,0.32)]",
    icon: Loader2,
    iconClass: "text-brand-400",
  },
  failure: {
    label: "Failed",
    dot: "bg-red-500",
    glow: "shadow-[0_0_24px_rgba(239,68,68,0.24)]",
    icon: XCircle,
    iconClass: "text-red-400",
  },
  skipped: {
    label: "Skipped",
    dot: "bg-surface-600",
    glow: "shadow-none",
    icon: SkipForward,
    iconClass: "text-surface-400",
  },
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function formatRunDuration(run: WorkflowRun): string {
  const endTime = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const duration = Math.max(endTime - new Date(run.startedAt).getTime(), 0);
  return formatDuration(duration);
}

function stringifyValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) => stringifyValue(item))
      .filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join("\n") : null;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

function extractThoughtProcess(step: StepResult): string | null {
  const output = step.output ?? {};
  const thoughtKeys = [
    "thought",
    "thoughts",
    "reasoning",
    "analysis",
    "summary",
    "explanation",
    "message",
    "log",
  ];

  for (const key of thoughtKeys) {
    if (key in output) {
      const text = stringifyValue(output[key]);
      if (text) return text;
    }
  }

  if (Array.isArray(step.agentSlotResults) && step.agentSlotResults.length > 0) {
    const transcript = step.agentSlotResults
      .flatMap((slot) =>
        slot.messages.map((message) => `slot ${slot.slotIndex} ${message.from}: ${message.content}`)
      )
      .filter(Boolean)
      .join("\n");

    if (transcript) return transcript;
  }

  const serialized = stringifyValue(output);
  return serialized && serialized !== "{}" ? serialized : null;
}

function getDefaultExpandedIndex(steps: StepResult[]): number {
  const runningIndex = steps.findIndex((step) => step.status === "running");
  if (runningIndex >= 0) return runningIndex;

  const failureIndex = steps.findIndex((step) => step.status === "failure");
  if (failureIndex >= 0) return failureIndex;

  return Math.max(steps.length - 1, 0);
}

function JsonLine({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}) {
  return <div style={{ paddingLeft: `${depth * 14}px` }}>{children}</div>;
}

function JsonValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): React.ReactElement {
  if (Array.isArray(value)) {
    return (
      <>
        <JsonLine depth={depth}>[</JsonLine>
        {value.map((item, index) => (
          <JsonLine key={index} depth={depth + 1}>
            <JsonValue value={item} depth={0} />
            {index < value.length - 1 ? "," : ""}
          </JsonLine>
        ))}
        <JsonLine depth={depth}>]</JsonLine>
      </>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return (
      <>
        <JsonLine depth={depth}>{"{"}</JsonLine>
        {entries.map(([key, entryValue], index) => (
          <JsonLine key={key} depth={depth + 1}>
            <span className="text-[#818cf8]">"{key}"</span>: <JsonValue value={entryValue} depth={0} />
            {index < entries.length - 1 ? "," : ""}
          </JsonLine>
        ))}
        <JsonLine depth={depth}>{"}"}</JsonLine>
      </>
    );
  }

  if (typeof value === "string") {
    return <span className="text-[#14b8a6]">"{value}"</span>;
  }

  if (typeof value === "number") {
    return <span className="text-[#f97316]">{value}</span>;
  }

  if (typeof value === "boolean") {
    return <span className="text-surface-300">{String(value)}</span>;
  }

  if (value === null) {
    return <span className="text-surface-500">null</span>;
  }

  return <span className="text-surface-500">undefined</span>;
}

function JsonPanel({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-surface-800 bg-surface-950">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-surface-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-surface-500 transition hover:bg-surface-900"
        aria-expanded={open}
      >
        <span>{label}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="run-audit-mono overflow-x-auto px-3 py-3 text-xs leading-6 text-surface-300">
          <JsonValue value={value} />
        </div>
      )}
    </div>
  );
}

function AuditStepCard({
  step,
  index,
  active,
  isLast,
  expanded,
  onToggle,
}: {
  step: StepResult;
  index: number;
  active: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusMeta = STEP_STATUS_META[step.status];
  const StatusIcon = statusMeta.icon;
  const thoughtProcess = useMemo(() => extractThoughtProcess(step), [step]);
  const [showData, setShowData] = useState(false);
  const hasOutput = Boolean(step.output && Object.keys(step.output).length > 0);
  const iconBorderClass =
    step.status === "success"
      ? "border-emerald-500"
      : step.status === "failure"
        ? "border-red-500"
        : active
          ? "border-brand-500"
          : "border-surface-700";
  const TimelineStatusIcon = step.status === "failure" ? AlertCircle : StatusIcon;

  return (
    <div className="run-audit-step-enter relative pl-12" style={{ animationDelay: `${index * 20}ms` }}>
      {!isLast && (
        <div className="absolute left-[15px] top-10 h-[calc(100%-1rem)] w-0.5 bg-surface-800">
          <div
            className={clsx(
              "h-full w-full bg-gradient-to-b from-brand-500 to-accent-teal transition-opacity duration-300",
              step.status === "success" || step.status === "running" ? "opacity-100" : "opacity-30"
            )}
          />
        </div>
      )}

      <div
        className={clsx(
          "absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border bg-surface-800",
          iconBorderClass,
          statusMeta.glow
        )}
      >
        {step.status === "running" ? (
          <TimelineStatusIcon size={15} className={clsx(statusMeta.iconClass, "animate-spin")} />
        ) : (
          <TimelineStatusIcon size={15} className={statusMeta.iconClass} />
        )}
      </div>

      <div
        className={clsx(
          "rounded-2xl border px-4 py-4 transition-all duration-200",
          active
            ? "border-brand-500/40 bg-surface-800/90 shadow-[0_18px_40px_rgba(2,6,23,0.28)]"
            : "border-surface-700/70 bg-surface-900/65 hover:border-surface-600"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-surface-700 bg-surface-950 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-surface-400">
                Step {index + 1}
              </span>
              <span className={clsx("h-2 w-2 rounded-full", statusMeta.dot)} />
              <span className="text-[11px] uppercase tracking-[0.2em] text-surface-500">
                {statusMeta.label}
              </span>
            </div>
            <h3 className="text-sm font-medium text-surface-50">{step.stepName}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-400">
              <span className="run-audit-mono text-[11px] text-surface-500">{step.stepId}</span>
              {step.durationMs > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock3 size={11} />
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={step.status} />
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-950/80 px-2.5 py-1 text-[11px] font-medium text-surface-300 transition hover:border-brand-500/50 hover:text-surface-50"
              aria-expanded={expanded}
            >
              Thought Process
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button
              type="button"
              onClick={() => setShowData((current) => !current)}
              className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-950/80 px-2.5 py-1 text-[11px] font-medium text-surface-300 transition hover:border-brand-500/50 hover:text-surface-50"
              aria-expanded={showData}
            >
              Data I/O
              {showData ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>

        {step.error && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {step.error}
          </div>
        )}

        <div
          className={clsx(
            "overflow-hidden transition-all duration-200 ease-out",
            expanded ? "mt-3 max-h-[28rem] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="rounded-xl border border-surface-800 bg-surface-950 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-surface-600">
              <Brain size={12} />
              Thinking...
            </div>
            {thoughtProcess ? (
              <pre className="run-audit-mono overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-surface-300">
                {thoughtProcess}
              </pre>
            ) : (
              <p className="run-audit-mono text-xs leading-6 text-surface-500">
                No reasoning trace was captured for this step.
              </p>
            )}
          </div>
        </div>

        <div
          className={clsx(
            "overflow-hidden transition-all duration-200 ease-out",
            showData ? "mt-3 max-h-[24rem] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="space-y-2">
            {hasOutput ? (
              <JsonPanel label="Output" value={step.output} defaultOpen />
            ) : (
              <div className="rounded-xl border border-surface-800 bg-surface-950 px-3 py-3">
                <p className="run-audit-mono text-xs leading-6 text-surface-500">
                  No step output was captured for this step.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunAuditSidebar({
  run,
  open,
  onClose,
}: {
  run: WorkflowRun | null;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState(0);

  useEffect(() => {
    if (!open || !run) return;

    setExpandedIndex(getDefaultExpandedIndex(run.stepResults));

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, run]);

  if (!run) return null;

  const completedSteps = run.stepResults.filter((step) => step.status === "success").length;
  const popoutHref = buildWorkflowBuilderRoute(run.templateId, {
    popout: true,
    mode: "readonly",
    from: "/history",
  });

  return (
    <div
      className={clsx(
        "pointer-events-none fixed inset-0 z-50 transition-opacity duration-200",
        open ? "opacity-100" : "opacity-0"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={clsx(
          "absolute inset-0 bg-surface-950/55 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-label="Dismiss run audit backdrop"
      />

      <aside
        className={clsx(
          "pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-[400px] flex-col border-l border-surface-700/50 bg-surface-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.6)] backdrop-blur-[12px] transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Run audit view"
      >
        <div className="border-b border-surface-700/70 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-surface-500">
                <Workflow size={12} />
                Run Audit
              </div>
              <h2 className="truncate text-lg font-semibold text-surface-50">{run.templateName}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={run.status} />
                <span className="rounded-full border border-surface-700 bg-surface-950 px-2.5 py-1 text-xs text-surface-300">
                  {completedSteps}/{run.stepResults.length} complete
                </span>
                <span className="rounded-full border border-surface-700 bg-surface-950 px-2.5 py-1 text-xs text-surface-400">
                  {formatRunDuration(run)}
                </span>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => window.open(popoutHref, "_blank", "noopener,noreferrer")}
                  className="inline-flex items-center gap-2 rounded-full border border-brand-500/35 bg-surface-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-surface-50 shadow-[0_14px_28px_rgba(15,23,42,0.26)] transition duration-200 ease-in-out hover:-translate-y-0.5 hover:border-brand-400/70 hover:shadow-[0_18px_36px_rgba(15,23,42,0.34)]"
                  aria-label={`Open ${run.templateName} in the workflow builder`}
                >
                  Open in Builder
                  <ArrowUpRight size={12} />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-surface-700 bg-surface-950/80 text-surface-300 transition hover:border-brand-500/50 hover:bg-surface-800 hover:text-surface-50"
              aria-label="Close audit sidebar"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-4 grid gap-2 rounded-2xl border border-surface-700/70 bg-surface-950/70 p-3 text-xs text-surface-400">
            <div className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.2em] text-surface-500">Run ID</span>
              <span className="run-audit-mono truncate text-surface-300">{run.id}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.2em] text-surface-500">Started</span>
              <span className="text-right text-surface-300">{new Date(run.startedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="run-audit-scrollbar overflow-y-auto px-6 py-5">
          <div className="mb-3">
            <JsonPanel label="Run Input" value={run.input} />
          </div>
          <div className="relative space-y-3">
            {run.stepResults.map((step, index) => (
              <AuditStepCard
                key={step.stepId}
                step={step}
                index={index}
                active={step.status === "running" || expandedIndex === index}
                isLast={index === run.stepResults.length - 1}
                expanded={expandedIndex === index}
                onToggle={() => setExpandedIndex((current) => (current === index ? -1 : index))}
              />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
