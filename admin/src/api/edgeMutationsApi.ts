import { apiRequest } from "../lib/apiClient";

interface BaseInput {
  reason: string;
}

export interface RollbackInput extends BaseInput {
  project: string;
  deploymentId: string;
  /** Required typed confirmation: "ROLLBACK". */
  confirm: string;
}

export async function rollbackCfDeploy(input: RollbackInput): Promise<void> {
  await apiRequest("/api/admin-console/infra/edge/actions/cf-pages/rollback", {
    method: "POST",
    body: {
      reason: input.reason,
      project: input.project,
      deployment_id: input.deploymentId,
      confirm: input.confirm,
    },
  });
}

export interface RetryDeployInput extends BaseInput {
  project: string;
  deploymentId: string;
}

export async function retryCfDeploy(input: RetryDeployInput): Promise<void> {
  await apiRequest("/api/admin-console/infra/edge/actions/cf-pages/retry", {
    method: "POST",
    body: {
      reason: input.reason,
      project: input.project,
      deployment_id: input.deploymentId,
    },
  });
}

export interface WorkflowRunInput extends BaseInput {
  runId: number;
  onlyFailed?: boolean;
}

export async function rerunWorkflowRun(input: WorkflowRunInput): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/edge/actions/workflow-runs/${input.runId}/rerun`,
    {
      method: "POST",
      body: { reason: input.reason, only_failed: input.onlyFailed ?? false },
    },
  );
}

export async function cancelWorkflowRun(input: BaseInput & { runId: number }): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/edge/actions/workflow-runs/${input.runId}/cancel`,
    {
      method: "POST",
      body: { reason: input.reason },
    },
  );
}
