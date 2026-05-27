import { apiRequest } from "../lib/apiClient";

export type JobState = "waiting" | "active" | "delayed" | "failed" | "completed" | "paused";

export interface QueueCounters {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

export interface QueueListEntry {
  name: string;
  available: boolean;
  counters?: QueueCounters;
  error?: string;
}

export async function listInspectorQueues(): Promise<QueueListEntry[]> {
  const res = await apiRequest<{ queues: QueueListEntry[] }>(
    "/api/admin-console/infra/queues/inspector",
  );
  return res.queues;
}

export interface QueueWorker {
  name: string | null;
  addr: string | null;
  age: number | null;
  idle: number | null;
}

export interface QueueDetail {
  name: string;
  counters: QueueCounters;
  workers: QueueWorker[];
  throughput: {
    completed_per_minute: number[];
    failed_per_minute: number[];
    window_minutes: number;
  };
}

export async function fetchQueueDetail(name: string): Promise<QueueDetail> {
  return apiRequest<QueueDetail>(
    `/api/admin-console/infra/queues/inspector/${encodeURIComponent(name)}`,
  );
}

export interface JobSummary {
  id: string;
  name: string;
  state: string;
  timestamp: number;
  processed_on: number | null;
  finished_on: number | null;
  attempts_made: number;
  attempts_total: number | null;
  delay: number | null;
  failed_reason: string | null;
}

export interface JobsPage {
  name: string;
  state: JobState;
  start: number;
  page_size: number;
  jobs: JobSummary[];
  returned: number;
}

export async function listJobs(
  queueName: string,
  opts: { state: JobState; start?: number; pageSize?: number; q?: string },
): Promise<JobsPage> {
  return apiRequest<JobsPage>(
    `/api/admin-console/infra/queues/inspector/${encodeURIComponent(queueName)}/jobs`,
    {
      query: {
        state: opts.state,
        start: opts.start ?? 0,
        pageSize: opts.pageSize ?? 25,
        q: opts.q ?? "",
      },
    },
  );
}

export interface JobDetail {
  id: string;
  name: string;
  state: string;
  data: unknown;
  return_value: unknown;
  failed_reason: string | null;
  stacktrace: string[];
  attempts_made: number;
  attempts_total: number | null;
  opts: Record<string, unknown>;
  timestamp: number;
  processed_on: number | null;
  finished_on: number | null;
  logs: string[];
}

export async function fetchJobDetail(queueName: string, jobId: string): Promise<JobDetail> {
  return apiRequest<JobDetail>(
    `/api/admin-console/infra/queues/inspector/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
  );
}
