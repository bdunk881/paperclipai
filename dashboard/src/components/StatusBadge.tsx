import clsx from "clsx";

type RunStatus = "queued" | "pending" | "running" | "completed" | "failed" | "escalated" | "awaiting_approval" | "canceled";
type StepStatus = "success" | "failure" | "skipped" | "running";
type MissionStatus = "On Track" | "At Risk" | "Blocked" | "Off Track" | "Not Started";

// Status palette maps to the af2 editorial tones:
// sage = healthy / live / running, clay = alert / blocked / failed,
// mustard = pending / awaiting, plum = governance / escalated, ink-3 = neutral.
const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  queued: "bg-af2-paper-2 text-af2-ink-3",
  pending: "bg-af2-paper-2 text-af2-ink-3",
  running: "bg-af2-sage/15 text-af2-sage",
  completed: "bg-af2-sage/15 text-af2-sage",
  failed: "bg-af2-clay/15 text-af2-clay",
  escalated: "bg-af2-plum/15 text-af2-plum",
  awaiting_approval: "bg-af2-mustard/15 text-af2-mustard",
  canceled: "bg-af2-paper-2 text-af2-ink-4",
};

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  success: "bg-af2-sage/15 text-af2-sage",
  failure: "bg-af2-clay/15 text-af2-clay",
  skipped: "bg-af2-paper-2 text-af2-ink-3",
  running: "bg-af2-mustard/15 text-af2-mustard",
};

const MISSION_STATUS_STYLES: Record<MissionStatus, string> = {
  "On Track": "bg-af2-sage/15 text-af2-sage",
  "At Risk": "bg-af2-mustard/15 text-af2-mustard",
  Blocked: "bg-af2-clay/15 text-af2-clay",
  "Off Track": "bg-af2-clay/15 text-af2-clay",
  "Not Started": "bg-af2-paper-2 text-af2-ink-3",
};

const MISSION_STATUS_DOT: Record<MissionStatus, string> = {
  "On Track": "bg-af2-sage",
  "At Risk": "bg-af2-mustard",
  Blocked: "bg-af2-clay",
  "Off Track": "bg-af2-clay",
  "Not Started": "bg-af2-ink-4",
};

const RUN_LABELS: Partial<Record<RunStatus, string>> = {
  awaiting_approval: "awaiting approval",
};

function isRunStatus(status: string): status is RunStatus {
  return ["queued", "pending", "running", "completed", "failed", "escalated", "awaiting_approval", "canceled"].includes(status);
}

function isMissionStatus(status: string): status is MissionStatus {
  return ["On Track", "At Risk", "Blocked", "Off Track", "Not Started"].includes(status);
}

export function StatusBadge({ status }: { status: RunStatus | StepStatus | MissionStatus }) {
  const styles = isRunStatus(status)
    ? RUN_STATUS_STYLES[status]
    : isMissionStatus(status)
      ? MISSION_STATUS_STYLES[status]
      : STEP_STATUS_STYLES[status as StepStatus];

  const label = isRunStatus(status) ? (RUN_LABELS[status] ?? status) : status;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200",
        !isMissionStatus(status) && "capitalize",
        styles
      )}
    >
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-af2-sage animate-pulse" />
      )}
      {status === "awaiting_approval" && (
        <span className="w-1.5 h-1.5 rounded-full bg-af2-mustard animate-pulse" />
      )}
      {isMissionStatus(status) && <span className={clsx("h-1.5 w-1.5 rounded-full", MISSION_STATUS_DOT[status])} />}
      {label}
    </span>
  );
}
