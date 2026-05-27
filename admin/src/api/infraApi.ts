import { apiRequest } from "../lib/apiClient";

export type StatusLevel = "ok" | "warn" | "error" | "unknown";

export interface StatusPill {
  id: string;
  label: string;
  level: StatusLevel;
  detail?: string;
}

export interface InfraAuditRow {
  id: string;
  admin_user_id: string;
  action: string;
  reason: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface InfraOverview {
  pills: StatusPill[];
  recent_audit: InfraAuditRow[];
}

export async function fetchInfraOverview(): Promise<InfraOverview> {
  return apiRequest<InfraOverview>("/api/admin-console/infra/overview");
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  image_ref?: { repository?: string; tag?: string; digest?: string };
  instance_id?: string;
  private_ip?: string;
  created_at?: string;
  updated_at?: string;
  checks?: Array<{
    name: string;
    status: string;
    output?: string;
    updated_at?: string;
  }>;
}

export interface FlyAppView {
  appName: string;
  machines: FlyMachine[];
  error?: string;
}

export interface QueueCounters {
  name: string;
  available: boolean;
  waiting?: number;
  active?: number;
  delayed?: number;
  failed?: number;
  completed?: number;
  paused?: number;
  error?: string;
}

export interface JobRunRow {
  id: string;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  outcome: "success" | "failure" | "partial" | "skipped";
  message: string | null;
  payload: Record<string, unknown>;
}

export interface InfraCompute {
  fly: FlyAppView[];
  queues: QueueCounters[];
  scheduled_jobs: Record<string, JobRunRow[]>;
  redis: { configured: boolean; reachable: boolean };
  bullboard_url: string;
}

export async function fetchInfraCompute(): Promise<InfraCompute> {
  return apiRequest<InfraCompute>("/api/admin-console/infra/compute");
}
