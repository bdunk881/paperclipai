import { apiRequest } from "../lib/apiClient";

interface BaseInput {
  reason: string;
}

export interface RestartFlyMachineInput extends BaseInput {
  app: string;
  machineId: string;
  /** Required when app is production ("RESTART" uppercase). */
  confirm?: string;
}

export async function restartFlyMachine(input: RestartFlyMachineInput): Promise<void> {
  await apiRequest("/api/admin-console/infra/compute/actions/fly/restart-machine", {
    method: "POST",
    body: {
      reason: input.reason,
      app: input.app,
      machine_id: input.machineId,
      confirm: input.confirm,
    },
  });
}

export interface QueueJobMutationInput extends BaseInput {
  queueName: string;
  jobId: string;
}

export async function retryJob(input: QueueJobMutationInput): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/retry-job/${encodeURIComponent(input.jobId)}`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function promoteJob(input: QueueJobMutationInput): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/promote-job/${encodeURIComponent(input.jobId)}`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function removeJob(input: QueueJobMutationInput): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/remove-job/${encodeURIComponent(input.jobId)}`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function replayDlqJob(input: { jobId: string; reason: string }): Promise<{ new_job_id: string }> {
  return apiRequest<{ ok: true; new_job_id: string }>(
    `/api/admin-console/infra/compute/actions/queues/runs-dlq/replay/${encodeURIComponent(input.jobId)}`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function pauseQueue(input: { queueName: string; reason: string }): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/pause`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function resumeQueue(input: { queueName: string; reason: string }): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/resume`,
    { method: "POST", body: { reason: input.reason } },
  );
}

export async function drainQueue(input: {
  queueName: string;
  reason: string;
  includeDelayed?: boolean;
}): Promise<{ counts_before: Record<string, number> }> {
  return apiRequest<{ ok: true; counts_before: Record<string, number> }>(
    `/api/admin-console/infra/compute/actions/queues/${encodeURIComponent(input.queueName)}/drain`,
    {
      method: "POST",
      body: {
        reason: input.reason,
        acknowledge: "DRAIN",
        delayed: input.includeDelayed ?? false,
      },
    },
  );
}

export async function triggerScheduledJob(input: { jobName: string; reason: string }): Promise<void> {
  await apiRequest(
    `/api/admin-console/infra/compute/actions/scheduled-jobs/${encodeURIComponent(input.jobName)}/trigger`,
    { method: "POST", body: { reason: input.reason } },
  );
}
