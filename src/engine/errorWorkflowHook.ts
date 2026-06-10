/**
 * Error-workflow hook (HEL-772, Phase 1) — pure dispatch planning.
 *
 * When a run fails, a workflow may designate an *error workflow* to run with the
 * failure context (n8n's per-workflow Error Workflow / trigger.dev onFailure).
 * The designation is `template.onErrorWorkflowId` (migration-free — it rides the
 * DAG JSON). This module decides *whether* to fire and *what input* to pass; the
 * engine does the (impure) load + `startRun`. Keeping the decision pure makes the
 * loop guard + input shape trivially testable.
 */

/**
 * Run-input/context marker flagging that a run *is itself* an error workflow.
 * The hook refuses to fire an error workflow for a failed error-workflow run, so
 * a perpetually-failing error workflow can't loop.
 */
export const ERROR_WORKFLOW_MARKER = "__isErrorWorkflow";

export interface ErrorWorkflowDispatch {
  /** The designated error workflow's `workflows.id`. */
  workflowId: string;
  /** Input for the error run (carries the failure context + the loop marker). */
  input: Record<string, unknown>;
}

/**
 * Decide whether a failed run should fire its designated error workflow, and
 * build the error run's input. Returns `null` (no dispatch) when there is no
 * designation, no workspace to scope the load, or the failing run is itself an
 * error workflow (loop guard).
 */
export function planErrorWorkflowDispatch(params: {
  onErrorWorkflowId: string | undefined;
  workspaceId: string | undefined;
  isErrorWorkflowRun: boolean;
  failedRunId: string;
  failedStepId: string;
  templateId: string;
  templateName: string;
  error: string | undefined;
}): ErrorWorkflowDispatch | null {
  const workflowId =
    typeof params.onErrorWorkflowId === "string" ? params.onErrorWorkflowId.trim() : "";
  if (!workflowId) {
    return null;
  }
  if (params.isErrorWorkflowRun) {
    // The failed run is itself an error workflow — never fire another.
    return null;
  }
  if (!params.workspaceId) {
    return null;
  }

  return {
    workflowId,
    input: {
      workspaceId: params.workspaceId,
      [ERROR_WORKFLOW_MARKER]: true,
      errorTrigger: {
        failedRunId: params.failedRunId,
        failedStepId: params.failedStepId,
        templateId: params.templateId,
        templateName: params.templateName,
        error: params.error ?? null,
      },
    },
  };
}
