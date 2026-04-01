import clsx from "clsx";

type RunStatus = "pending" | "running" | "completed" | "failed" | "escalated";
type StepStatus = "success" | "failure" | "skipped" | "running";

const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  escalated: "bg-purple-100 text-purple-700",
};

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  success: "bg-green-100 text-green-700",
  failure: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
  running: "bg-yellow-100 text-yellow-700",
};

export function StatusBadge({ status }: { status: RunStatus | StepStatus }) {
  const isRunStatus = ["pending", "running", "completed", "failed", "escalated"].includes(status);
  const styles = isRunStatus
    ? RUN_STATUS_STYLES[status as RunStatus]
    : STEP_STATUS_STYLES[status as StepStatus];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
        styles
      )}
    >
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
      )}
      {status}
    </span>
  );
}
