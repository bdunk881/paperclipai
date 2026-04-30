import { WorkflowTemplate } from "../types/workflow";

export type AgentLifecycleStatus = "active" | "paused" | "terminated";
export type HeartbeatStatus = "queued" | "running" | "completed" | "blocked";
export type ControlPlaneTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type AgentScheduleType = "manual" | "interval" | "cron";
export type TeamDeploymentMode = "workflow_runtime" | "continuous_agents";
export type TeamLifecycleStatus = "active" | "paused" | "stopped";
export type SpendCategory = "llm" | "tool" | "api" | "compute" | "ad_spend" | "third_party";
export type BudgetAlertScope = "team" | "agent" | "tool";
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

export interface ControlPlaneRoleTemplateDefinition {
  id: string;
  name: string;
  description: string;
  defaultModel?: string;
  defaultInstructions: string;
  defaultSkills: string[];
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
  pausedByCompanyLifecycle?: boolean;
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
  pausedByCompanyLifecycle?: boolean;
  restartCount: number;
  lastHeartbeatAt?: string;
  budgetMonthlyUsd: number;
  toolBudgetCeilings: Record<string, number>;
  alertThresholds: number[];
  orchestrationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MissionStateStatus = "on_track" | "at_risk" | "blocked" | "off_track" | "not_started";
export type MissionStateStaffingStatus = "ready" | "partial" | "not_ready";

export interface ControlPlaneMissionState {
  teamId: string;
  title: string;
  objective: string | null;
  overallStatus: MissionStateStatus;
  currentPhase: string | null;
  ownerTeam: string | null;
  staffingReadiness: {
    status: MissionStateStaffingStatus;
    filledHeadcount: number;
    plannedHeadcount: number;
  };
  topBlockers: string[];
  risks: string[];
  nextMilestone: string | null;
  lastUpdated: string;
  fieldCoverage: {
    title: boolean;
    objective: boolean;
    overallStatus: boolean;
    currentPhase: boolean;
    ownerTeam: boolean;
    staffingReadiness: boolean;
    topBlockers: boolean;
    risks: boolean;
    nextMilestone: boolean;
    lastUpdated: boolean;
  };
}

export interface ProvisionedCompanySecretBinding {
  key: string;
  maskedValue: string;
}

export interface ProvisionedCompanyWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionedCompanyRecord {
  id: string;
  userId: string;
  name: string;
  externalCompanyId?: string;
  workspaceId: string;
  teamId: string;
  idempotencyKey: string;
  budgetMonthlyUsd: number;
  allocatedBudgetMonthlyUsd: number;
  remainingBudgetMonthlyUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProvisioningAgentInput {
  roleTemplateId: string;
  roleKey?: string;
  name?: string;
  budgetMonthlyUsd?: number;
  model?: string;
  instructions?: string;
  skills?: string[];
}

export interface CompanyProvisioningResult {
  company: ProvisionedCompanyRecord;
  workspace: ProvisionedCompanyWorkspace;
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  secretBindings: ProvisionedCompanySecretBinding[];
  availableSkills: ControlPlaneSkillDefinition[];
  idempotentReplay: boolean;
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

export interface ControlPlaneSpendEntry {
  id: string;
  teamId: string;
  agentId: string;
  userId: string;
  executionId?: string;
  category: SpendCategory;
  costUsd: number;
  model?: string;
  provider?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  recordedAt: string;
}

export interface ControlPlaneBudgetAlert {
  id: string;
  userId: string;
  teamId: string;
  agentId?: string;
  toolName?: string;
  scope: BudgetAlertScope;
  threshold: number;
  budgetUsd: number;
  spentUsd: number;
  recordedAt: string;
}

export interface BudgetStatusSnapshot {
  scope: BudgetAlertScope;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  thresholdState: "healthy" | "warning" | "critical" | "limit_reached";
  alertThresholdsTriggered: number[];
  autoPaused: boolean;
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

export interface TeamSpendSnapshot {
  period: string;
  team: BudgetStatusSnapshot;
  agents: Array<BudgetStatusSnapshot & { agentId: string; name: string }>;
  tools: Array<BudgetStatusSnapshot & { toolName: string }>;
  alerts: ControlPlaneBudgetAlert[];
  totalsByCategory: Partial<Record<SpendCategory, number>>;
}

export interface ControlPlaneDeployment {
  team: ControlPlaneTeam;
  agents: ControlPlaneAgent[];
  workflow: Pick<WorkflowTemplate, "id" | "name" | "category" | "version">;
  availableSkills: ControlPlaneSkillDefinition[];
}
