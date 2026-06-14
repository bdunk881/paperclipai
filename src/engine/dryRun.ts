/**
 * Dry-run mode (HEL-786) — eval / test-run safety. When a run's config carries
 * the dry-run flag, the engine no-ops the side-effecting step kinds instead of
 * firing real webhooks / CRM writes / emails / agent actions. This is the
 * prerequisite "blocker" for HEL-776 (run a workflow over a dataset N times) and
 * is independently useful as a builder "test run".
 *
 * Pure policy only — the engine (`WorkflowEngine._runSteps`) wires these into the
 * side-effecting cases and propagates the flag into sub-workflow children.
 */
import type { StepKind, WorkflowStep } from "../types/workflow";

/** Config/context key marking a run (and its sub-workflows) as a dry run. */
export const DRY_RUN_KEY = "__dryRun";

/**
 * Step kinds whose executors reach EXTERNAL systems and must be skipped in a dry
 * run. Deliberately narrow: `llm` runs (you're evaluating its output), control
 * flow runs, and `transform`/`output` are pure — only the connector/tool/agent
 * executors actually side-effect.
 */
const DRY_RUN_SKIP_KINDS: readonly StepKind[] = ["action", "mcp", "agent"];

/** True when the run config/context marks this as a dry run. */
export function isDryRun(config: Record<string, unknown> | undefined | null): boolean {
  return !!config && config[DRY_RUN_KEY] === true;
}

/** True when a step kind's executor side-effects and should be skipped in dry-run. */
export function dryRunSkips(kind: StepKind): boolean {
  return DRY_RUN_SKIP_KINDS.includes(kind);
}

/**
 * The no-op output for a skipped side-effecting step: a `__dryRun` marker plus
 * the step's declared `outputKeys` seeded to `null`, so downstream `{{key}}`
 * references resolve (to null) instead of leaving the rest of the run broken.
 */
export function dryRunOutput(step: WorkflowStep): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [DRY_RUN_KEY]: true,
    skipped: true,
    skippedKind: step.kind,
  };
  for (const key of step.outputKeys ?? []) out[key] = null;
  return out;
}

/**
 * HEL-789: a `wait` step's no-op output under dry-run. A wait normally *pauses*
 * the run (duration / until / webhook); in a dry run we never pause — a paused
 * run never reaches a terminal state, which would stall an eval forever. So the
 * wait resolves immediately and the run continues.
 */
export function dryRunWaitOutput(): Record<string, unknown> {
  return { [DRY_RUN_KEY]: true, waited: false, skippedWait: true };
}

/**
 * HEL-789: an `approval` step's auto-pass output under dry-run. An approval
 * normally pauses for human resolution (`awaiting_approval`); in a dry run we
 * auto-approve — the optimistic happy path, which is what an eval measures — so
 * the run runs to completion instead of stalling on HITL.
 */
export function dryRunApprovalOutput(): Record<string, unknown> {
  return {
    [DRY_RUN_KEY]: true,
    approved: true,
    approvalDecision: "approved",
    approvalId: null,
    approverComment: null,
    autoApproved: true,
  };
}
