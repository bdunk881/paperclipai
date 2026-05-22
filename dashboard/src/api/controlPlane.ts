import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type ControlPlaneAgentStatus = "active" | "paused" | "terminated";
export type ControlPlaneHeartbeatStatus = "queued" | "running" | "completed" | "blocked";
export type ControlPlaneTaskStatus = "todo" | "in_progress" | "done" | "blocked";
// HEL-142: ControlPlaneScheduleType + ControlPlaneSchedule retired
// 2026-05-21. agents.schedule dropped (migration 057); scheduling
// lives in routines.

export interface ControlPlaneTeam {
  id: string;
  name: string;
  description?: string;
  workflowId?: string;
  workflowName?: string;
  deploymentMode: "workflow_runtime" | "continuous_agents";
  budgetMonthlyUsd: number;
  orchestrationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneAgent {
  id: string;
  teamId: string;
  name: string;
  roleKey: string;
  workflowStepId?: string;
  workflowStepKind?: string;
  model?: string;
  instructions: string;
  budgetMonthlyUsd: number;
  reportingToAgentId?: string;
  status: ControlPlaneAgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneTaskAuditEvent {
  id: string;
  type: "created" | "checked_out" | "status_changed";
  actor: string;
  timestamp: string;
  detail: string;
}

export interface ControlPlaneTask {
  id: string;
  teamId: string;
  title: string;
  description?: string;
  sourceRunId?: string;
  sourceWorkflowStepId?: string;
  assignedAgentId?: string;
  checkedOutBy?: string;
  checkedOutAt?: string;
  status: ControlPlaneTaskStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  auditTrail: ControlPlaneTaskAuditEvent[];
}

export interface ControlPlaneHeartbeat {
  id: string;
  teamId: string;
  agentId: string;
  status: ControlPlaneHeartbeatStatus;
  summary?: string;
  costUsd?: number;
  createdTaskIds: string[];
  startedAt: string;
  completedAt?: string;
}

export interface ControlPlaneTeamDetail {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  tasks: ControlPlaneTask[];
  heartbeats: ControlPlaneHeartbeat[];
}

/**
 * HEL-143: a single threshold trip emitted by `applyBudgetPolicies` when
 * a team or agent crosses one of the configured `alertThresholds` values
 * (e.g. 50% / 80% / 100% of monthly budget). One row per (team, agent,
 * tool, scope, threshold) — the unique-index in migration 019 dedupes
 * within a window.
 */
export interface ControlPlaneBudgetAlert {
  id: string;
  teamId: string;
  userId: string;
  agentId?: string;
  toolName?: string;
  /** 'team' | 'agent' | 'tool' — which budget tier tripped. */
  scope: string;
  /** Fractional threshold (0.5 = 50%, 0.8 = 80%, 1.0 = 100%). */
  threshold: number;
  budgetUsd: number;
  spentUsd: number;
  recordedAt: string;
}

export interface ControlPlaneDeploymentResponse {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  workflow: {
    id: string;
    name: string;
    category: string;
    version: string;
  };
}

export interface DeployWorkflowTeamInput {
  templateId: string;
  teamName?: string;
  budgetMonthlyUsd?: number;
  defaultIntervalMinutes?: number;
}

let mutationRunId: string | null = null;

function authHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return {
    ...(extra ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

function getMutationRunId(): string {
  if (!mutationRunId) {
    const suffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mutationRunId = `dashboard-ui-${suffix}`;
  }
  return mutationRunId;
}

export async function listControlPlaneTeams(accessToken: string): Promise<ControlPlaneTeam[]> {
  const res = await fetch(`${BASE}/control-plane/teams`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch control plane teams: ${res.status}`);
  }
  const data = (await res.json()) as { teams: ControlPlaneTeam[] };
  return data.teams;
}

export async function getControlPlaneTeamDetail(
  teamId: string,
  accessToken: string
): Promise<ControlPlaneTeamDetail> {
  const res = await fetch(`${BASE}/control-plane/teams/${encodeURIComponent(teamId)}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch control plane team: ${res.status}`);
  }
  return res.json() as Promise<ControlPlaneTeamDetail>;
}

export async function getControlPlaneSnapshot(accessToken: string): Promise<ControlPlaneTeamDetail[]> {
  const teams = await listControlPlaneTeams(accessToken);
  return Promise.all(teams.map((team) => getControlPlaneTeamDetail(team.id, accessToken)));
}

/**
 * HEL-143: fetch budget alerts (workspace-scoped, ordered newest first).
 * Pre-HEL-143 nothing read this table — alerts accumulated as a
 * write-only audit trail. Surfaces in BudgetDashboard's "Recent budget
 * alerts" panel.
 */
export async function listBudgetAlerts(
  accessToken: string,
  options: { teamId?: string } = {},
): Promise<ControlPlaneBudgetAlert[]> {
  const params = new URLSearchParams();
  if (options.teamId) params.set("teamId", options.teamId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${BASE}/control-plane/budget-alerts${query}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch budget alerts: ${res.status}`);
  }
  const data = (await res.json()) as { alerts: ControlPlaneBudgetAlert[]; total: number };
  return data.alerts;
}

export type CompanyLifecycleStatus = "active" | "paused";

export interface CompanyLifecycleState {
  userId: string;
  status: CompanyLifecycleStatus;
  pauseReason?: string;
  pausedAt?: string;
  updatedAt: string;
  updatedByRunId: string;
}

export interface CompanyLifecycleMutationResult {
  state: CompanyLifecycleState;
  affectedTeamIds: string[];
  affectedAgentIds: string[];
}

export async function getCompanyLifecycle(
  accessToken: string,
): Promise<CompanyLifecycleState> {
  const res = await fetch(`${BASE}/control-plane/company/lifecycle`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Failed to load company lifecycle: ${res.status}`);
  }
  return res.json() as Promise<CompanyLifecycleState>;
}

export async function updateCompanyLifecycle(
  accessToken: string,
  action: "pause" | "resume",
  reason?: string,
): Promise<CompanyLifecycleMutationResult> {
  const res = await fetch(`${BASE}/control-plane/company/lifecycle`, {
    method: "POST",
    headers: authHeaders(accessToken, {
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": getMutationRunId(),
    }),
    body: JSON.stringify({
      action,
      ...(reason !== undefined ? { reason } : {}),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Failed to update company lifecycle: ${res.status}`);
  }
  return res.json() as Promise<CompanyLifecycleMutationResult>;
}

export async function deployWorkflowAsTeam(
  input: DeployWorkflowTeamInput,
  accessToken: string
): Promise<ControlPlaneDeploymentResponse> {
  const res = await fetch(`${BASE}/control-plane/deployments/workflow`, {
    method: "POST",
    headers: authHeaders(accessToken, {
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": getMutationRunId(),
    }),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Failed to deploy workflow team: ${res.status}`);
  }

  return res.json() as Promise<ControlPlaneDeploymentResponse>;
}
