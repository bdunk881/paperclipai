import { apiRequest } from "../lib/apiClient";

export interface CFPagesDeploymentStage {
  name: string;
  status: string;
  started_on?: string;
  ended_on?: string;
}

export interface CFPagesDeployment {
  id: string;
  short_id?: string;
  created_on?: string;
  modified_on?: string;
  environment?: string;
  url?: string;
  source_branch?: string;
  source_commit_hash?: string;
  source_commit_message?: string;
  is_skipped?: boolean;
  latest_stage_name?: string;
  latest_stage_status?: string;
  latest_stage_started_on?: string;
  latest_stage_ended_on?: string;
  stages: CFPagesDeploymentStage[];
}

export interface CFPagesProjectView {
  project_name: string;
  available: boolean;
  exists?: boolean;
  production_branch?: string;
  subdomain?: string;
  domains?: string[];
  deployments: CFPagesDeployment[];
  error?: string;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
}

export interface SentryProjectRollup {
  project_slug: string;
  available: boolean;
  unresolved_24h: number | null;
  top_issues: SentryIssue[];
  error?: string;
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string;
  status: string | null;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  head_sha: string;
  run_number: number;
  run_attempt: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  duration_seconds?: number | null;
}

export interface WorkflowRunsView {
  workflow_file: string;
  available: boolean;
  runs: WorkflowRun[];
  error?: string;
}

export interface InfraEdge {
  cloudflare: { projects: CFPagesProjectView[]; configured: boolean };
  sentry: { rollups: SentryProjectRollup[]; configured: boolean };
  github_actions: { workflows: WorkflowRunsView[]; configured: boolean };
}

export async function fetchInfraEdge(): Promise<InfraEdge> {
  return apiRequest<InfraEdge>("/api/admin-console/infra/edge");
}
