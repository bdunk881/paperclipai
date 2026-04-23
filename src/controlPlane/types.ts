import { WorkflowTemplate } from "../types/workflow";

export type AgentLifecycleStatus = "active" | "paused" | "terminated";
export type HeartbeatStatus = "queued" | "running" | "completed" | "blocked";
export type ControlPlaneTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type AgentScheduleType = "manual" | "interval" | "cron";
export type TeamDeploymentMode = "workflow_runtime" | "continuous_agents";
export type TeamLifecycleStatus = "active" | "paused" | "stopped";
export type ControlPlaneExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "stopped";
export type ControlPlaneLifecycleAction = "pause" | "resume" | "restart" | "stop";

export interface ControlPlaneAgentSchedule {
  type: AgentScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
}

export interface ControlPlaneSkillDefinition {
  id: string;
  name: string;
  description: string;
  scope: "workflow" | "agent" | "security" | "integration";
}

export interface ControlPlaneAgent {
  id: string;
  teamId: string;
  userId: string;
  name: string;
  roleKey: string;
  workflowStepId?: string;
  workflowStepKind?: string;
  model?: string;
  instructions: string;
  budgetMonthlyUsd: number;
  reportingToAgentId?: string;
  skills: string[];
  schedule: ControlPlaneAgentSchedule;
  status: AgentLifecycleStatus;
  currentExecutionId?: string;
  lastHeartbeatAt?: string;
  lastHeartbeatStatus?: HeartbeatStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneTeam {
  id: string;
  userId: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
  deploymentMode: TeamDeploymentMode;
  status: TeamLifecycleStatus;
  restartCount: number;
  lastHeartbeatAt?: string;
  budgetMonthlyUsd: number;
  orchestrationEnabled: boolean;
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
  userId: string;
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

export interface AgentHeartbeatRecord {
  id: string;
  teamId: string;
  agentId: string;
  executionId?: string;
  userId: string;
  status: HeartbeatStatus;
  summary?: string;
  costUsd?: number;
  createdTaskIds: string[];
  startedAt: string;
  completedAt?: string;
}

export interface ControlPlaneExecution {
  id: string;
  teamId: string;
  agentId: string;
  userId: string;
  sourceRunId: string;
  sourceWorkflowStepId: string;
  sourceWorkflowStepName: string;
  taskId?: string;
  status: ControlPlaneExecutionStatus;
  appliedSkills: string[];
  metadata?: Record<string, unknown>;
  summary?: string;
  costUsd?: number;
  requestedAt: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  restartCount: number;
}

export interface ControlPlaneDeployment {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  workflow: Pick<WorkflowTemplate, "id" | "name" | "category" | "version">;
  availableSkills: ControlPlaneSkillDefinition[];
}
