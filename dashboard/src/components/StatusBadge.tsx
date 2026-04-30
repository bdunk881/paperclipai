import clsx from "clsx";

type RunStatus = "pending" | "running" | "completed" | "failed" | "escalated" | "awaiting_approval";
type StepStatus = "success" | "failure" | "skipped" | "running";
type MissionStatus = "On Track" | "At Risk" | "Blocked" | "Off Track" | "Not Started";

const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  escalated: "bg-purple-100 text-purple-700",
  awaiting_approval: "bg-orange-100 text-orange-700",
};

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  success: "bg-green-100 text-green-700",
  failure: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
  running: "bg-yellow-100 text-yellow-700",
};

const MISSION_STATUS_STYLES: Record<MissionStatus, string> = {
  "On Track": "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200",
  "At Risk": "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200",
  Blocked: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  "Off Track": "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  "Not Started": "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200",
};

const MISSION_STATUS_DOT: Record<MissionStatus, string> = {
  "On Track": "bg-accent-teal",
  "At Risk": "bg-accent-orange",
  Blocked: "bg-red-500",
  "Off Track": "bg-red-500",
  "Not Started": "bg-slate-400 dark:bg-slate-300",
};

const RUN_LABELS: Partial<Record<RunStatus, string>> = {
  awaiting_approval: "awaiting approval",
};

function isRunStatus(status: string): status is RunStatus {
  return ["pending", "running", "completed", "failed", "escalated", "awaiting_approval"].includes(status);
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
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
      )}
      {status === "awaiting_approval" && (
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
      )}
      {isMissionStatus(status) && <span className={clsx("h-1.5 w-1.5 rounded-full", MISSION_STATUS_DOT[status])} />}
      {label}
    </span>
  );
}
