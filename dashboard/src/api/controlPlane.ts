import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type ControlPlaneAgentStatus = "active" | "paused" | "terminated";
export type ControlPlaneHeartbeatStatus = "queued" | "running" | "completed" | "blocked";
export type ControlPlaneTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type ControlPlaneScheduleType = "manual" | "interval" | "cron";

export interface ControlPlaneSchedule {
  type: ControlPlaneScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
}

export interface ControlPlaneTeam {
  id: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
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
  schedule: ControlPlaneSchedule;
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
