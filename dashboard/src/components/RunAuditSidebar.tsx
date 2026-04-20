import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import "./RunAuditSidebar.css";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  Play,
  SkipForward,
  Sparkles,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { StepResult, WorkflowRun } from "../types/workflow";

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

function pickStepGlyph(step: StepResult): LucideIcon {
  const name = `${step.stepId} ${step.stepName}`.toLowerCase();
  if (name.includes("agent")) return Bot;
  if (name.includes("approval")) return CheckCircle2;
  if (name.includes("llm") || name.includes("reason") || name.includes("think")) return Brain;
  if (name.includes("mcp") || name.includes("tool")) return Sparkles;
  if (name.includes("trigger")) return Play;
  return Workflow;
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
  const StepGlyph = pickStepGlyph(step);
  const StatusIcon = statusMeta.icon;
  const thoughtProcess = useMemo(() => extractThoughtProcess(step), [step]);

  return (
    <div className="relative pl-12">
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
          "absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-surface-700 bg-surface-800",
          statusMeta.glow
        )}
      >
        {step.status === "running" ? (
          <StatusIcon size={15} className={clsx(statusMeta.iconClass, "animate-spin")} />
        ) : (
          <StepGlyph size={15} className={statusMeta.iconClass} />
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
              {typeof step.attemptCount === "number" && step.attemptCount > 1 && (
                <span>{step.attemptCount} attempts</span>
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
          <div className="rounded-xl border-l-2 border-brand-500/30 bg-surface-950 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-surface-500">
              <Brain size={12} />
              Thought Process
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
          "pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-surface-700/50 bg-surface-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.6)] backdrop-blur-xl transition-transform duration-300 ease-out",
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
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-surface-700 bg-surface-950/80 text-surface-300 transition hover:border-brand-500/50 hover:text-surface-50"
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

        <div className="overflow-y-auto px-6 py-5">
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
