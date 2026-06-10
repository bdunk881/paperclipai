/**
 * HEL-772: error-workflow hook — pure planning unit tests.
 *
 * Covers the fire/no-fire decision (designation present, missing, loop-guard
 * marker, missing workspace) and the failure-context input shape.
 */

import { planErrorWorkflowDispatch, ERROR_WORKFLOW_MARKER } from "./errorWorkflowHook";

const base = {
  onErrorWorkflowId: "err-wf",
  workspaceId: "ws1",
  isErrorWorkflowRun: false,
  failedRunId: "run-1",
  failedStepId: "step-2",
  templateId: "tpl-1",
  templateName: "Main",
  error: "boom",
};

describe("planErrorWorkflowDispatch (HEL-772)", () => {
  it("plans a dispatch with the failure context when a workflow is designated", () => {
    const plan = planErrorWorkflowDispatch(base);
    expect(plan).not.toBeNull();
    expect(plan!.workflowId).toBe("err-wf");
    expect(plan!.input).toMatchObject({
      workspaceId: "ws1",
      [ERROR_WORKFLOW_MARKER]: true,
      errorTrigger: {
        failedRunId: "run-1",
        failedStepId: "step-2",
        templateId: "tpl-1",
        templateName: "Main",
        error: "boom",
      },
    });
  });

  it("returns null when no error workflow is designated", () => {
    expect(planErrorWorkflowDispatch({ ...base, onErrorWorkflowId: undefined })).toBeNull();
    expect(planErrorWorkflowDispatch({ ...base, onErrorWorkflowId: "   " })).toBeNull();
  });

  it("returns null when the failed run is itself an error workflow (loop guard)", () => {
    expect(planErrorWorkflowDispatch({ ...base, isErrorWorkflowRun: true })).toBeNull();
  });

  it("returns null when there is no workspace to scope the load", () => {
    expect(planErrorWorkflowDispatch({ ...base, workspaceId: undefined })).toBeNull();
  });

  it("coerces a missing error message to null", () => {
    const plan = planErrorWorkflowDispatch({ ...base, error: undefined });
    expect((plan!.input.errorTrigger as Record<string, unknown>).error).toBeNull();
  });
});
