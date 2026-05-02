import { randomUUID } from "crypto";
import { PoolClient } from "pg";
import { WorkflowStep, WorkflowTemplate } from "../types/workflow";
import { DEFAULT_ROLE_LIBRARY } from "../goals/teamAssembly";
import { getPostgresPool, isPostgresConfigured } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { assertAgentWorkspaceBinding } from "../security/agentWorkspaceBinding";
import { companyLifecycleStore } from "./companyLifecycleStore";
import {
  AgentHeartbeatRecord,
  BudgetStatusSnapshot,
  CompanyProvisioningAgentInput,
  ControlPlaneMissionState,
  CompanyProvisioningResult,
  ControlPlaneAgent,
  ControlPlaneBudgetAlert,
  ControlPlaneDeployment,
  ControlPlaneExecution,
  ControlPlaneExecutionStatus,
  ControlPlaneLifecycleAction,
  ControlPlaneRoleTemplateDefinition,
  ControlPlaneSkillDefinition,
  ControlPlaneSpendEntry,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
  HeartbeatStatus,
  ProvisionedCompanyRecord,
  ProvisionedCompanySecretBinding,
  ProvisionedCompanyWorkspace,
  SpendCategory,
  TeamSpendSnapshot,
} from "./types";
import { observabilityStore } from "../observability/store";
import { secretsRepository } from "./secretsRepository";
import { controlPlaneRepository } from "./controlPlaneRepository";

function nowIso(): string {
  return new Date().toISOString();
}

function currentPeriodKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function periodKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

function budgetAlertDedupeKey(input: {
  userId: string;
  teamId: string;
  period: string;
  scope: ControlPlaneBudgetAlert["scope"];
  agentId?: string;
  toolName?: string;
  threshold: number;
}): string {
  return [
    input.userId,
    input.teamId,
    input.period,
    input.scope,
    input.agentId ?? "",
    input.toolName ?? "",
    input.threshold,
  ].join(":");
}

const SLUGIFY_MAX_INPUT_LENGTH = 256;

function slugify(value: string): string {
  const bounded = value.slice(0, SLUGIFY_MAX_INPUT_LENGTH);
  const lower = bounded.trim().toLowerCase();
  const chars: number[] = [];
  let lastWasDash = false;
  for (let i = 0; i < lower.length; i += 1) {
    const code = lower.charCodeAt(i);
    const isAlnum =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isAlnum) {
      chars.push(code);
      lastWasDash = false;
    } else if (!lastWasDash) {
      chars.push(45);
      lastWasDash = true;
    }
  }

  let start = 0;
  let end = chars.length;
  while (start < end && chars[start] === 45) {
    start += 1;
  }
  while (end > start && chars[end - 1] === 45) {
    end -= 1;
  }

  return String.fromCharCode(...chars.slice(start, end));
}

function buildAuditEvent(
  type: ControlPlaneTaskAuditEvent["type"],
  actor: string,
  detail: string
): ControlPlaneTaskAuditEvent {
  return {
    id: randomUUID(),
    type,
    actor,
    detail,
    timestamp: nowIso(),
  };
}

function inferObservabilityActor(actor: string): { type: "run" | "system"; id: string; label?: string } {
  if (actor.startsWith("run-")) {
    return { type: "run", id: actor, label: actor };
  }
  return { type: "system", id: actor, label: actor };
}

function toAgentStatus(action: ControlPlaneLifecycleAction): ControlPlaneAgent["status"] {
  switch (action) {
    case "pause":
      return "paused";
    case "stop":
      return "terminated";
    case "restart":
    case "resume":
      return "active";
  }
}

function inferRoleKey(step: WorkflowStep, index?: number): string {
  return step.agentRoleKey ?? `${slugify(step.kind)}${index !== undefined ? `-${index + 1}` : ""}`;
}

function inferSkills(step: WorkflowStep): string[] {
  return Array.isArray(step.agentSkills)
    ? step.agentSkills.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

function toHeartbeatStatus(status: ControlPlaneExecutionStatus): HeartbeatStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
    case "failed":
    case "stopped":
      return "completed";
  }
}

function shouldResetLegacyAgentErrorStatus(heartbeatStatus: HeartbeatStatus): boolean {
  return heartbeatStatus === "running" || heartbeatStatus === "completed";
}

function normalizeAgentStatusForSuccessfulHeartbeat(
  agent: ControlPlaneAgent,
  heartbeatStatus: HeartbeatStatus
): void {
  if (shouldResetLegacyAgentErrorStatus(heartbeatStatus) && (agent.status as string) === "error") {
    agent.status = "active";
  }
}

function modelForTier(tier: "lite" | "standard" | "power"): string {
  switch (tier) {
    case "lite":
      return "gpt-5.4-mini";
    case "standard":
      return "gpt-5.4";
    case "power":
      return "gpt-5.2";
  }
}

function thresholdStateForPercent(percentUsed: number): BudgetStatusSnapshot["thresholdState"] {
  if (percentUsed >= 1) {
    return "limit_reached";
  }
  if (percentUsed >= 0.9) {
    return "critical";
  }
  if (percentUsed >= 0.8) {
    return "warning";
  }
  return "healthy";
}

const BASE_SKILL_CATALOG: ControlPlaneSkillDefinition[] = [
  {
    id: "paperclip",
    name: "paperclip",
    description: "Paperclip control-plane coordination and issue management.",
    scope: "workflow",
  },
  {
    id: "security-review",
    name: "security-review",
    description: "Secure coding checklist and review patterns for sensitive changes.",
    scope: "security",
  },
  {
    id: "openai-docs",
    name: "openai-docs",
    description: "Official OpenAI documentation retrieval and upgrade guidance.",
    scope: "integration",
  },
  {
    id: "gh-cli",
    name: "gh-cli",
    description: "GitHub CLI execution support for repository and CI workflows.",
    scope: "agent",
  },
];

const SKILL_CATALOG: ControlPlaneSkillDefinition[] = [
  ...BASE_SKILL_CATALOG,
  ...Array.from(
    new Set(DEFAULT_ROLE_LIBRARY.flatMap((role) => role.defaultSkills).filter((skill) => skill !== "paperclip"))
  ).map((skill) => ({
    id: skill,
    name: skill,
    description: `AutoFlow role skill ${skill}.`,
    scope: "agent" as const,
  })),
];

const BASE_ROLE_TEMPLATE_CATALOG: ControlPlaneRoleTemplateDefinition[] = [
  {
    id: "workspace-manager",
    name: "Workspace Manager",
    description: "Coordinates tenant-level provisioning, operations, and audit trail ownership.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Own workspace-level orchestration, keep tenant systems healthy, and coordinate downstream agents.",
    defaultSkills: ["paperclip"],
  },
  {
    id: "backend-engineer",
    name: "Backend Engineer",
    description: "Implements APIs, data models, and server-side integrations for the tenant.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Build and maintain backend APIs, integrations, and persistence for the customer workspace.",
    defaultSkills: ["paperclip", "security-review"],
  },
  {
    id: "integration-engineer",
    name: "Integration Engineer",
    description: "Owns third-party connectors, credentials, and external system setup for the tenant.",
    defaultModel: "gpt-5.4",
    defaultInstructions:
      "Configure and maintain customer integrations, credentials, and operational playbooks.",
    defaultSkills: ["paperclip", "openai-docs"],
  },
  {
    id: "github-operator",
    name: "GitHub Operator",
    description: "Handles repository automation, PR workflows, and CI follow-up tasks.",
    defaultModel: "gpt-5.4-mini",
    defaultInstructions:
      "Operate GitHub workflows safely, with strong auditability and fast CI feedback loops.",
    defaultSkills: ["paperclip", "gh-cli"],
  },
];

const ROLE_TEMPLATE_CATALOG: ControlPlaneRoleTemplateDefinition[] = [
  ...BASE_ROLE_TEMPLATE_CATALOG,
  ...DEFAULT_ROLE_LIBRARY.filter(
    (role) => !BASE_ROLE_TEMPLATE_CATALOG.some((template) => template.id === role.roleKey)
  ).map((role) => ({
    id: role.roleKey,
    name: role.title,
    description: role.mandate,
    defaultModel: modelForTier(role.defaultModelTier),
    defaultInstructions: role.mandate,
    defaultSkills: [...role.defaultSkills],
  })),
];
const teams = new Map<string, ControlPlaneTeam>();
const agents = new Map<string, ControlPlaneAgent>();
const tasks = new Map<string, ControlPlaneTask>();
const heartbeats = new Map<string, AgentHeartbeatRecord>();
const executions = new Map<string, ControlPlaneExecution>();
const companies = new Map<string, ProvisionedCompanyRecord>();
const companyWorkspaces = new Map<string, ProvisionedCompanyWorkspace>();
const companySecretBindings = new Map<string, Record<string, string>>();
const companyIdempotencyIndex = new Map<string, { companyId: string; fingerprint: string }>();
const spendEntries = new Map<string, ControlPlaneSpendEntry>();
const budgetAlerts = new Map<string, ControlPlaneBudgetAlert>();
const teamWorkspaceIds = new Map<string, string>();
const teamCompanyIds = new Map<string, string>();
const companyTenantWorkspaceIds = new Map<string, string>();
const hydratedWorkspaceUsers = new Set<string>();

type PersistedTeamRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  workflow_template_name: string | null;
  deployment_mode: ControlPlaneTeam["deploymentMode"];
  status: ControlPlaneTeam["status"];
  paused_by_company_lifecycle: boolean;
  restart_count: number;
  budget_monthly_usd: number | string;
  tool_budget_ceilings: unknown;
  alert_thresholds: unknown;
  orchestration_enabled: boolean;
  last_heartbeat_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PersistedAgentRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  team_id: string;
  name: string;
  role_key: string;
  workflow_step_id: string | null;
  workflow_step_kind: string | null;
  model: string | null;
  instructions: string | null;
  budget_monthly_usd: number | string;
  reporting_to_agent_id: string | null;
  skills: unknown;
  schedule: unknown;
  status: ControlPlaneAgent["status"];
  paused_by_company_lifecycle: boolean;
  current_execution_id: string | null;
  last_heartbeat_at: Date | string | null;
  last_heartbeat_status: ControlPlaneAgent["lastHeartbeatStatus"] | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PersistedExecutionRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  team_id: string;
  agent_id: string;
  source_run_id: string;
  source_workflow_step_id: string;
  source_workflow_step_name: string;
  task_id: string | null;
  status: ControlPlaneExecution["status"];
  applied_skills: unknown;
  metadata: unknown;
  summary: string | null;
  cost_usd: number | string | null;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  restart_count: number;
};

type PersistedProvisionedCompanyRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  external_company_id: string | null;
  provisioned_workspace_id: string;
  provisioned_workspace_name: string;
  provisioned_workspace_slug: string;
  team_id: string;
  idempotency_key: string;
  budget_monthly_usd: number | string;
  allocated_budget_monthly_usd: number | string;
  remaining_budget_monthly_usd: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

function getSkillCatalogIds(): Set<string> {
  return new Set(SKILL_CATALOG.map((skill) => skill.id));
}

function getRoleTemplateById(roleTemplateId: string): ControlPlaneRoleTemplateDefinition | undefined {
  return ROLE_TEMPLATE_CATALOG.find((template) => template.id === roleTemplateId);
}

function ensureValidSkillIds(skillIds: string[]): void {
  const validSkillIds = getSkillCatalogIds();
  const invalidSkills = skillIds.filter((skill) => !validSkillIds.has(skill));
  if (invalidSkills.length > 0) {
    throw new Error(`invalid_skills:${invalidSkills.join(",")}`);
  }
}

function mergeSkills(defaultSkills: string[], requestedSkills: string[] = []): string[] {
  const merged = Array.from(new Set([...defaultSkills, ...requestedSkills]));
  ensureValidSkillIds(merged);
  return merged.sort();
}

function maskSecretValue(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "****";
  }
  const suffix = trimmed.slice(-4);
  return `${"*".repeat(Math.max(8, trimmed.length - suffix.length))}${suffix}`;
}

function buildCompanySecretSummaries(secretBindings: Record<string, string>): ProvisionedCompanySecretBinding[] {
  return Object.entries(secretBindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      maskedValue: maskSecretValue(value),
    }));
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  return 0;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, entryValue]) => {
    if (typeof entryValue === "number") {
      acc[key] = entryValue;
      return acc;
    }
    if (typeof entryValue === "string" && entryValue.trim().length > 0) {
      acc[key] = Number(entryValue);
    }
    return acc;
  }, {});
}

function normalizeNumberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const parsed = value.filter((entry): entry is number => typeof entry === "number");
  return parsed.length > 0 ? [...parsed].sort((left, right) => left - right) : [...fallback];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeSchedule(value: unknown): ControlPlaneAgent["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "manual" };
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "interval" && typeof candidate.intervalMinutes === "number") {
    return { type: "interval", intervalMinutes: candidate.intervalMinutes };
  }
  if (candidate.type === "cron" && typeof candidate.cronExpression === "string") {
    return { type: "cron", cronExpression: candidate.cronExpression };
  }
  return { type: "manual" };
}

function requireWorkspaceIdForPersistence(workspaceId: string | undefined): string {
  if (!workspaceId?.trim()) {
    throw new Error("workspace_context_required");
  }
  return workspaceId;
}

function workspaceUserKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

function workspaceContextForTeam(teamId: string, userId: string): { workspaceId: string; userId: string } | undefined {
  if (!isPostgresConfigured()) {
    return undefined;
  }
  const workspaceId = teamWorkspaceIds.get(teamId);
  if (!workspaceId) {
    return undefined;
  }
  return { workspaceId, userId };
}

function matchesWorkspace(teamId: string, workspaceId?: string): boolean {
  if (!workspaceId) {
    return true;
  }

  const storedWorkspaceId = teamWorkspaceIds.get(teamId);
  return storedWorkspaceId ? storedWorkspaceId === workspaceId : true;
}

function serializeProvisioningFingerprint(input: {
  name: string;
  workspaceName?: string;
  externalCompanyId?: string;
  budgetMonthlyUsd: number;
  orchestrationEnabled?: boolean;
  secretBindings: Record<string, string>;
  agents: CompanyProvisioningAgentInput[];
}): string {
  const normalizedSecrets = Object.entries(input.secretBindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value]);
  const normalizedAgents = input.agents.map((agent) => ({
    roleTemplateId: agent.roleTemplateId,
    name: agent.name?.trim() ?? null,
    budgetMonthlyUsd: agent.budgetMonthlyUsd ?? null,
    model: agent.model?.trim() ?? null,
    instructions: agent.instructions?.trim() ?? null,
    skills: [...(agent.skills ?? [])].sort(),
  }));
  return JSON.stringify({
    name: input.name.trim(),
    workspaceName: input.workspaceName?.trim() ?? null,
    externalCompanyId: input.externalCompanyId?.trim() ?? null,
    budgetMonthlyUsd: input.budgetMonthlyUsd,
    orchestrationEnabled: input.orchestrationEnabled ?? true,
    secretBindings: normalizedSecrets,
    agents: normalizedAgents,
  });
}

function makeProvisioningRoleKey(roleTemplateId: string, occurrence: number): string {
  return occurrence === 0 ? roleTemplateId : `${roleTemplateId}-${occurrence + 1}`;
}

function getProvisionedCompanyOwnedByUser(companyId: string, userId: string): ProvisionedCompanyRecord | undefined {
  const company = companies.get(companyId);
  if (!company || company.userId !== userId) {
    return undefined;
  }
  return company;
}

function latestIso(...timestamps: Array<string | undefined>): string {
  return timestamps
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? nowIso();
}

function buildMissionState(
  team: ControlPlaneTeam,
): ControlPlaneMissionState {
  const teamAgents = Array.from(agents.values()).filter((agent) => agent.teamId === team.id);
  const teamTasks = Array.from(tasks.values()).filter((task) => task.teamId === team.id);
  const teamExecutions = Array.from(executions.values()).filter((execution) => execution.teamId === team.id);
  const spendSnapshot = buildTeamSpendSnapshot(team);
  const blockedTasks = teamTasks.filter((task) => task.status === "blocked");
  const failedExecutions = teamExecutions.filter((execution) => execution.status === "failed");
  const blockedExecutions = teamExecutions.filter((execution) => execution.status === "blocked");
  const hasRuntimeActivity = teamTasks.length > 0 || teamExecutions.length > 0;

  let overallStatus: ControlPlaneMissionState["overallStatus"] = "on_track";
  if (!hasRuntimeActivity) {
    overallStatus = "not_started";
  } else if (team.status === "stopped" || failedExecutions.length > 0) {
    overallStatus = "off_track";
  } else if (team.status === "paused" || blockedTasks.length > 0) {
    overallStatus = "blocked";
  } else if (
    blockedExecutions.length > 0 ||
    spendSnapshot.team.thresholdState === "warning" ||
    spendSnapshot.team.thresholdState === "critical" ||
    spendSnapshot.team.thresholdState === "limit_reached"
  ) {
    overallStatus = "at_risk";
  }

  const plannedHeadcount = teamAgents.length;
  const filledHeadcount = teamAgents.filter((agent) => agent.status !== "terminated").length;
  let staffingStatus: ControlPlaneMissionState["staffingReadiness"]["status"] = "ready";
  if (filledHeadcount === 0) {
    staffingStatus = "not_ready";
  } else if (filledHeadcount < plannedHeadcount) {
    staffingStatus = "partial";
  }

  const risks: string[] = [];
  if (spendSnapshot.team.thresholdState === "warning" || spendSnapshot.team.thresholdState === "critical") {
    risks.push(`Budget usage is ${Math.round(spendSnapshot.team.percentUsed * 100)}% of monthly allocation.`);
  }
  if (spendSnapshot.team.thresholdState === "limit_reached") {
    risks.push("Team budget limit has been reached.");
  }
  if (failedExecutions.length > 0) {
    risks.push(`${failedExecutions.length} execution${failedExecutions.length === 1 ? "" : "s"} failed.`);
  }

  const topBlockers = blockedTasks.map((task) => task.title);
  if (team.status === "paused" && topBlockers.length === 0) {
    topBlockers.push("Team is currently paused.");
  }
  if (team.status === "stopped" && topBlockers.length === 0) {
    topBlockers.push("Team is currently stopped.");
  }

  return {
    teamId: team.id,
    title: team.name,
    objective: team.description?.trim() || null,
    overallStatus,
    currentPhase: null,
    ownerTeam: team.name,
    staffingReadiness: {
      status: staffingStatus,
      filledHeadcount,
      plannedHeadcount,
    },
    topBlockers,
    risks: Array.from(new Set(risks)),
    nextMilestone: null,
    lastUpdated: latestIso(
      team.updatedAt,
      ...teamTasks.map((task) => task.updatedAt),
      ...teamExecutions.map(
        (execution) => execution.lastHeartbeatAt ?? execution.completedAt ?? execution.startedAt ?? execution.requestedAt
      )
    ),
    fieldCoverage: {
      title: true,
      objective: Boolean(team.description?.trim()),
      overallStatus: true,
      currentPhase: false,
      ownerTeam: true,
      staffingReadiness: plannedHeadcount > 0,
      topBlockers: true,
      risks: true,
      nextMilestone: false,
      lastUpdated: true,
    },
  };
}

function listAccessibleTeamIds(userId: string, workspaceId?: string): Set<string> {
  const accessibleTeamIds = new Set(
    Array.from(teams.values())
      .filter((team) => team.userId === userId && matchesWorkspace(team.id, workspaceId))
      .map((team) => team.id)
  );

  const normalizedWorkspaceId = workspaceId?.trim();
  if (!normalizedWorkspaceId) {
    return accessibleTeamIds;
  }

  Array.from(companies.values())
    .filter((company) => {
      const tenantWorkspaceId = companyTenantWorkspaceIds.get(company.id);
      return tenantWorkspaceId === normalizedWorkspaceId || company.workspaceId === normalizedWorkspaceId;
    })
    .forEach((company) => {
      accessibleTeamIds.add(company.teamId);
    });

  return accessibleTeamIds;
}

function canAccessTeam(team: ControlPlaneTeam | undefined, userId: string, workspaceId?: string): team is ControlPlaneTeam {
  if (!team) {
    return false;
  }
  return listAccessibleTeamIds(userId, workspaceId).has(team.id);
}

function canAccessAgent(agent: ControlPlaneAgent | undefined, userId: string, workspaceId?: string): agent is ControlPlaneAgent {
  if (!agent) {
    return false;
  }
  return canAccessTeam(teams.get(agent.teamId), userId, workspaceId);
}

function canAccessExecution(
  execution: ControlPlaneExecution | undefined,
  userId: string,
  workspaceId?: string
): execution is ControlPlaneExecution {
  if (!execution) {
    return false;
  }
  return canAccessTeam(teams.get(execution.teamId), userId, workspaceId);
}

function getTeamOwnedByUser(teamId: string, userId: string): ControlPlaneTeam | undefined {
  const team = teams.get(teamId);
  if (!team || team.userId !== userId) {
    return undefined;
  }
  return team;
}

function getAgentOwnedByUser(agentId: string, userId: string): ControlPlaneAgent | undefined {
  const agent = agents.get(agentId);
  if (!agent || agent.userId !== userId) {
    return undefined;
  }
  return agent;
}

function getExecutionOwnedByUser(executionId: string, userId: string): ControlPlaneExecution | undefined {
  const execution = executions.get(executionId);
  if (!execution || execution.userId !== userId) {
    return undefined;
  }
  return execution;
}

function hydrateTeam(row: PersistedTeamRow): ControlPlaneTeam {
  teamWorkspaceIds.set(row.id, row.workspace_id);
  if (row.company_id) {
    teamCompanyIds.set(row.id, row.company_id);
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    workflowTemplateId: row.workflow_template_id ?? undefined,
    workflowTemplateName: row.workflow_template_name ?? undefined,
    deploymentMode: row.deployment_mode,
    status: row.status,
    pausedByCompanyLifecycle: row.paused_by_company_lifecycle || undefined,
    restartCount: row.restart_count,
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    budgetMonthlyUsd: toNumber(row.budget_monthly_usd),
    toolBudgetCeilings: normalizeNumberRecord(row.tool_budget_ceilings),
    alertThresholds: normalizeNumberArray(row.alert_thresholds, [0.8, 0.9, 1]),
    orchestrationEnabled: row.orchestration_enabled,
    createdAt: toIso(row.created_at) ?? nowIso(),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
  };
}

function hydrateAgent(row: PersistedAgentRow): ControlPlaneAgent {
  teamWorkspaceIds.set(row.team_id, row.workspace_id);
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    name: row.name,
    roleKey: row.role_key,
    workflowStepId: row.workflow_step_id ?? undefined,
    workflowStepKind: row.workflow_step_kind ?? undefined,
    model: row.model ?? undefined,
    instructions: row.instructions ?? "",
    budgetMonthlyUsd: toNumber(row.budget_monthly_usd),
    reportingToAgentId: row.reporting_to_agent_id ?? undefined,
    skills: normalizeStringArray(row.skills),
    schedule: normalizeSchedule(row.schedule),
    status: row.status,
    pausedByCompanyLifecycle: row.paused_by_company_lifecycle || undefined,
    currentExecutionId: row.current_execution_id ?? undefined,
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    lastHeartbeatStatus: row.last_heartbeat_status ?? undefined,
    createdAt: toIso(row.created_at) ?? nowIso(),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
  };
}

function hydrateExecution(row: PersistedExecutionRow): ControlPlaneExecution {
  teamWorkspaceIds.set(row.team_id, row.workspace_id);
  return {
    id: row.id,
    teamId: row.team_id,
    agentId: row.agent_id,
    userId: row.user_id,
    sourceRunId: row.source_run_id,
    sourceWorkflowStepId: row.source_workflow_step_id,
    sourceWorkflowStepName: row.source_workflow_step_name,
    taskId: row.task_id ?? undefined,
    status: row.status,
    appliedSkills: normalizeStringArray(row.applied_skills),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : undefined,
    summary: row.summary ?? undefined,
    costUsd: row.cost_usd === null ? undefined : toNumber(row.cost_usd),
    requestedAt: toIso(row.requested_at) ?? nowIso(),
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    restartCount: row.restart_count,
  };
}

function hydrateProvisionedCompany(row: PersistedProvisionedCompanyRow): {
  company: ProvisionedCompanyRecord;
  workspace: ProvisionedCompanyWorkspace;
} {
  companyTenantWorkspaceIds.set(row.id, row.workspace_id);
  const workspace: ProvisionedCompanyWorkspace = {
    id: row.provisioned_workspace_id,
    name: row.provisioned_workspace_name,
    slug: row.provisioned_workspace_slug,
    createdAt: toIso(row.created_at) ?? nowIso(),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
  };

  const company: ProvisionedCompanyRecord = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    externalCompanyId: row.external_company_id ?? undefined,
    workspaceId: row.provisioned_workspace_id,
    teamId: row.team_id,
    idempotencyKey: row.idempotency_key,
    budgetMonthlyUsd: toNumber(row.budget_monthly_usd),
    allocatedBudgetMonthlyUsd: toNumber(row.allocated_budget_monthly_usd),
    remainingBudgetMonthlyUsd: toNumber(row.remaining_budget_monthly_usd),
    createdAt: toIso(row.created_at) ?? nowIso(),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
  };

  return { company, workspace };
}

async function ensureWorkspaceHydrated(workspaceId: string | undefined, userId: string): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  const resolvedWorkspaceId = requireWorkspaceIdForPersistence(workspaceId);
  const cacheKey = workspaceUserKey(resolvedWorkspaceId, userId);
  if (hydratedWorkspaceUsers.has(cacheKey)) {
    return;
  }

  // Phase 4.2: also hydrate tasks / heartbeats / spend / alerts so they
  // survive a process restart. Same RLS-bound context, separate repository
  // calls so the SQL stays factored alongside the rest of execution-state PG.
  const [hydratedTasks, hydratedHeartbeats, hydratedSpend, hydratedAlerts] = await Promise.all([
    controlPlaneRepository.listTasks({ workspaceId: resolvedWorkspaceId, userId }),
    controlPlaneRepository.listHeartbeats({ workspaceId: resolvedWorkspaceId, userId }),
    controlPlaneRepository.listSpendEntries({ workspaceId: resolvedWorkspaceId, userId }),
    controlPlaneRepository.listBudgetAlerts({ workspaceId: resolvedWorkspaceId, userId }),
  ]);

  await withWorkspaceContext(
    getPostgresPool(),
    { workspaceId: resolvedWorkspaceId, userId },
    async (client) => {
      const [teamResult, agentResult, executionResult, companyResult] = await Promise.all([
        client.query<PersistedTeamRow>(
          `SELECT id, workspace_id, user_id, company_id, name, description, workflow_template_id,
                  workflow_template_name, deployment_mode, status, paused_by_company_lifecycle,
                  restart_count, budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
                  orchestration_enabled, last_heartbeat_at, created_at, updated_at
             FROM control_plane_teams
            WHERE user_id = $1`,
          [userId]
        ),
        client.query<PersistedAgentRow>(
          `SELECT id, workspace_id, user_id, team_id, name, role_key, workflow_step_id,
                  workflow_step_kind, model, instructions, budget_monthly_usd, reporting_to_agent_id,
                  skills, schedule, status, paused_by_company_lifecycle, current_execution_id,
                  last_heartbeat_at, last_heartbeat_status, created_at, updated_at
             FROM control_plane_agents
            WHERE user_id = $1`,
          [userId]
        ),
        client.query<PersistedExecutionRow>(
          `SELECT id, workspace_id, user_id, team_id, agent_id, source_run_id,
                  source_workflow_step_id, source_workflow_step_name, task_id, status,
                  applied_skills, metadata, summary, cost_usd, requested_at, started_at,
                  completed_at, last_heartbeat_at, restart_count
             FROM control_plane_executions
            WHERE user_id = $1`,
          [userId]
        ),
        client.query<PersistedProvisionedCompanyRow>(
          `SELECT id, workspace_id, user_id, name, external_company_id,
                  provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
                  team_id, idempotency_key, budget_monthly_usd, allocated_budget_monthly_usd,
                  remaining_budget_monthly_usd, created_at, updated_at
             FROM provisioned_companies
            WHERE user_id = $1`,
          [userId]
        ),
      ]);

      teamResult.rows.forEach((row) => {
        teams.set(row.id, hydrateTeam(row));
      });
      agentResult.rows.forEach((row) => {
        agents.set(row.id, hydrateAgent(row));
      });
      executionResult.rows.forEach((row) => {
        executions.set(row.id, hydrateExecution(row));
      });
      companyResult.rows.forEach((row) => {
        const { company, workspace } = hydrateProvisionedCompany(row);
        companies.set(company.id, company);
        companyWorkspaces.set(workspace.id, workspace);
        companyIdempotencyIndex.set(`${company.userId}:${company.idempotencyKey}`, {
          companyId: company.id,
          fingerprint: "",
        });
      });
    }
  );

  hydratedTasks.forEach((task) => {
    tasks.set(task.id, task);
  });
  hydratedHeartbeats.forEach((heartbeat) => {
    heartbeats.set(heartbeat.id, heartbeat);
  });
  hydratedSpend.forEach((entry) => {
    spendEntries.set(entry.id, entry);
  });
  hydratedAlerts.forEach((alert) => {
    const dedupeKey = budgetAlertDedupeKey({
      userId: alert.userId,
      teamId: alert.teamId,
      period: periodKeyFromIso(alert.recordedAt),
      scope: alert.scope,
      agentId: alert.agentId,
      toolName: alert.toolName,
      threshold: alert.threshold,
    });
    budgetAlerts.set(dedupeKey, alert);
  });

  hydratedWorkspaceUsers.add(cacheKey);
}

async function upsertTeamRow(team: ControlPlaneTeam, workspaceId: string, client?: PoolClient): Promise<void> {
  const companyId = teamCompanyIds.get(team.id) ?? null;
  await (client ?? getPostgresPool()).query(
    `INSERT INTO control_plane_teams (
       id, workspace_id, user_id, company_id, name, description, workflow_template_id,
       workflow_template_name, deployment_mode, status, paused_by_company_lifecycle,
       restart_count, budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
       orchestration_enabled, last_heartbeat_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19
     )
     ON CONFLICT (id) DO UPDATE
       SET company_id = EXCLUDED.company_id,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           workflow_template_id = EXCLUDED.workflow_template_id,
           workflow_template_name = EXCLUDED.workflow_template_name,
           deployment_mode = EXCLUDED.deployment_mode,
           status = EXCLUDED.status,
           paused_by_company_lifecycle = EXCLUDED.paused_by_company_lifecycle,
           restart_count = EXCLUDED.restart_count,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           tool_budget_ceilings = EXCLUDED.tool_budget_ceilings,
           alert_thresholds = EXCLUDED.alert_thresholds,
           orchestration_enabled = EXCLUDED.orchestration_enabled,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           updated_at = EXCLUDED.updated_at`,
    [
      team.id,
      workspaceId,
      team.userId,
      companyId,
      team.name,
      team.description ?? null,
      team.workflowTemplateId ?? null,
      team.workflowTemplateName ?? null,
      team.deploymentMode,
      team.status,
      team.pausedByCompanyLifecycle ?? false,
      team.restartCount,
      team.budgetMonthlyUsd,
      JSON.stringify(team.toolBudgetCeilings),
      JSON.stringify(team.alertThresholds),
      team.orchestrationEnabled,
      team.lastHeartbeatAt ?? null,
      team.createdAt,
      team.updatedAt,
    ]
  );
}

async function upsertAgentRow(agent: ControlPlaneAgent, workspaceId: string, client?: PoolClient): Promise<void> {
  await (client ?? getPostgresPool()).query(
    `INSERT INTO control_plane_agents (
       id, workspace_id, user_id, team_id, name, role_key, workflow_step_id, workflow_step_kind,
       model, instructions, budget_monthly_usd, reporting_to_agent_id, skills, schedule,
       status, paused_by_company_lifecycle, current_execution_id, last_heartbeat_at,
       last_heartbeat_status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13::jsonb, $14::jsonb,
       $15, $16, $17, $18, $19, $20, $21
     )
     ON CONFLICT (id) DO UPDATE
       SET team_id = EXCLUDED.team_id,
           name = EXCLUDED.name,
           role_key = EXCLUDED.role_key,
           workflow_step_id = EXCLUDED.workflow_step_id,
           workflow_step_kind = EXCLUDED.workflow_step_kind,
           model = EXCLUDED.model,
           instructions = EXCLUDED.instructions,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           reporting_to_agent_id = EXCLUDED.reporting_to_agent_id,
           skills = EXCLUDED.skills,
           schedule = EXCLUDED.schedule,
           status = EXCLUDED.status,
           paused_by_company_lifecycle = EXCLUDED.paused_by_company_lifecycle,
           current_execution_id = EXCLUDED.current_execution_id,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           last_heartbeat_status = EXCLUDED.last_heartbeat_status,
           updated_at = EXCLUDED.updated_at`,
    [
      agent.id,
      workspaceId,
      agent.userId,
      agent.teamId,
      agent.name,
      agent.roleKey,
      agent.workflowStepId ?? null,
      agent.workflowStepKind ?? null,
      agent.model ?? null,
      agent.instructions,
      agent.budgetMonthlyUsd,
      agent.reportingToAgentId ?? null,
      JSON.stringify(agent.skills),
      JSON.stringify(agent.schedule),
      agent.status,
      agent.pausedByCompanyLifecycle ?? false,
      agent.currentExecutionId ?? null,
      agent.lastHeartbeatAt ?? null,
      agent.lastHeartbeatStatus ?? null,
      agent.createdAt,
      agent.updatedAt,
    ]
  );
}

async function upsertExecutionRow(
  execution: ControlPlaneExecution,
  workspaceId: string,
  client?: PoolClient
): Promise<void> {
  await (client ?? getPostgresPool()).query(
    `INSERT INTO control_plane_executions (
       id, workspace_id, user_id, team_id, agent_id, source_run_id, source_workflow_step_id,
       source_workflow_step_name, task_id, status, applied_skills, metadata, summary, cost_usd,
       requested_at, started_at, completed_at, last_heartbeat_at, restart_count
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14,
       $15, $16, $17, $18, $19
     )
     ON CONFLICT (id) DO UPDATE
       SET team_id = EXCLUDED.team_id,
           agent_id = EXCLUDED.agent_id,
           source_run_id = EXCLUDED.source_run_id,
           source_workflow_step_id = EXCLUDED.source_workflow_step_id,
           source_workflow_step_name = EXCLUDED.source_workflow_step_name,
           task_id = EXCLUDED.task_id,
           status = EXCLUDED.status,
           applied_skills = EXCLUDED.applied_skills,
           metadata = EXCLUDED.metadata,
           summary = EXCLUDED.summary,
           cost_usd = EXCLUDED.cost_usd,
           requested_at = EXCLUDED.requested_at,
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           restart_count = EXCLUDED.restart_count`,
    [
      execution.id,
      workspaceId,
      execution.userId,
      execution.teamId,
      execution.agentId,
      execution.sourceRunId,
      execution.sourceWorkflowStepId,
      execution.sourceWorkflowStepName,
      execution.taskId ?? null,
      execution.status,
      JSON.stringify(execution.appliedSkills),
      execution.metadata ? JSON.stringify(execution.metadata) : null,
      execution.summary ?? null,
      execution.costUsd ?? null,
      execution.requestedAt,
      execution.startedAt ?? null,
      execution.completedAt ?? null,
      execution.lastHeartbeatAt ?? null,
      execution.restartCount,
    ]
  );
}

async function upsertProvisionedCompanyRow(input: {
  company: ProvisionedCompanyRecord;
  workspace: ProvisionedCompanyWorkspace;
  tenantWorkspaceId: string;
  client?: PoolClient;
}): Promise<void> {
  companyTenantWorkspaceIds.set(input.company.id, input.tenantWorkspaceId);
  await (input.client ?? getPostgresPool()).query(
    `INSERT INTO provisioned_companies (
       id, workspace_id, user_id, name, external_company_id, provisioned_workspace_id,
       provisioned_workspace_name, provisioned_workspace_slug, team_id, idempotency_key,
       budget_monthly_usd, allocated_budget_monthly_usd, remaining_budget_monthly_usd,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15
     )
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           external_company_id = EXCLUDED.external_company_id,
           provisioned_workspace_name = EXCLUDED.provisioned_workspace_name,
           provisioned_workspace_slug = EXCLUDED.provisioned_workspace_slug,
           team_id = EXCLUDED.team_id,
           idempotency_key = EXCLUDED.idempotency_key,
           budget_monthly_usd = EXCLUDED.budget_monthly_usd,
           allocated_budget_monthly_usd = EXCLUDED.allocated_budget_monthly_usd,
           remaining_budget_monthly_usd = EXCLUDED.remaining_budget_monthly_usd,
           updated_at = EXCLUDED.updated_at`,
    [
      input.company.id,
      input.tenantWorkspaceId,
      input.company.userId,
      input.company.name,
      input.company.externalCompanyId ?? null,
      input.workspace.id,
      input.workspace.name,
      input.workspace.slug,
      input.company.teamId,
      input.company.idempotencyKey,
      input.company.budgetMonthlyUsd,
      input.company.allocatedBudgetMonthlyUsd,
      input.company.remainingBudgetMonthlyUsd,
      input.company.createdAt,
      input.company.updatedAt,
    ]
  );
}

function listSpendEntriesForPeriod(userId: string, period: string): ControlPlaneSpendEntry[] {
  return Array.from(spendEntries.values()).filter((entry) => {
    return entry.userId === userId && entry.recordedAt.startsWith(period);
  });
}

function buildBudgetSnapshot(input: {
  scope: "team" | "agent" | "tool";
  budgetUsd: number;
  spentUsd: number;
  autoPaused: boolean;
  alertThresholds: number[];
}): BudgetStatusSnapshot {
  const roundedSpend = Number(input.spentUsd.toFixed(2));
  const roundedBudget = Number(input.budgetUsd.toFixed(2));
  const remainingUsd = Number(Math.max(0, roundedBudget - roundedSpend).toFixed(2));
  const percentUsed = roundedBudget > 0 ? Number((roundedSpend / roundedBudget).toFixed(4)) : 0;
  const alertThresholdsTriggered = input.alertThresholds
    .filter((threshold) => roundedBudget > 0 && percentUsed >= threshold)
    .sort((left, right) => left - right);

  return {
    scope: input.scope,
    budgetUsd: roundedBudget,
    spentUsd: roundedSpend,
    remainingUsd,
    percentUsed,
    thresholdState: thresholdStateForPercent(percentUsed),
    alertThresholdsTriggered,
    autoPaused: input.autoPaused,
  };
}

function listAgentsForTeam(teamId: string, userId: string): ControlPlaneAgent[] {
  return Array.from(agents.values())
    .filter((agent) => agent.userId === userId && agent.teamId === teamId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildTeamSpendSnapshot(team: ControlPlaneTeam): TeamSpendSnapshot {
  const period = currentPeriodKey();
  const entries = listSpendEntriesForPeriod(team.userId, period).filter((entry) => entry.teamId === team.id);
  const alertThresholds = team.alertThresholds.length > 0 ? team.alertThresholds : [0.8, 0.9, 1];
  const teamSpent = entries.reduce((sum, entry) => sum + entry.costUsd, 0);
  const teamSnapshot = buildBudgetSnapshot({
    scope: "team",
    budgetUsd: team.budgetMonthlyUsd,
    spentUsd: teamSpent,
    autoPaused: team.status === "paused" && team.budgetMonthlyUsd > 0 && teamSpent >= team.budgetMonthlyUsd,
    alertThresholds,
  });

  const agentSnapshots = listAgentsForTeam(team.id, team.userId).map((agent) => {
    const spentUsd = entries
      .filter((entry) => entry.agentId === agent.id)
      .reduce((sum, entry) => sum + entry.costUsd, 0);
    return {
      agentId: agent.id,
      name: agent.name,
      ...buildBudgetSnapshot({
        scope: "agent",
        budgetUsd: agent.budgetMonthlyUsd,
        spentUsd,
        autoPaused: agent.status === "paused" && agent.budgetMonthlyUsd > 0 && spentUsd >= agent.budgetMonthlyUsd,
        alertThresholds,
      }),
    };
  });

  const toolSnapshots = Object.entries(team.toolBudgetCeilings)
    .map(([toolName, budgetUsd]) => {
      const spentUsd = entries
        .filter((entry) => entry.toolName === toolName)
        .reduce((sum, entry) => sum + entry.costUsd, 0);
      return {
        toolName,
        ...buildBudgetSnapshot({
          scope: "tool",
          budgetUsd,
          spentUsd,
          autoPaused: budgetUsd > 0 && spentUsd >= budgetUsd,
          alertThresholds,
        }),
      };
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));

  const totalsByCategory = entries.reduce<Partial<Record<SpendCategory, number>>>((totals, entry) => {
    totals[entry.category] = Number((((totals[entry.category] ?? 0) + entry.costUsd)).toFixed(2));
    return totals;
  }, {});

  const alerts = Array.from(budgetAlerts.values())
    .filter((alert) => alert.userId === team.userId && alert.teamId === team.id && alert.recordedAt.startsWith(period))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));

  return {
    period,
    team: teamSnapshot,
    agents: agentSnapshots,
    tools: toolSnapshots,
    alerts,
    totalsByCategory,
  };
}

async function upsertBudgetAlert(input: {
  team: ControlPlaneTeam;
  threshold: number;
  scope: "team" | "agent" | "tool";
  spentUsd: number;
  budgetUsd: number;
  agentId?: string;
  toolName?: string;
}): Promise<void> {
  if (input.budgetUsd <= 0 || input.spentUsd / input.budgetUsd < input.threshold) {
    return;
  }

  const dedupeKey = budgetAlertDedupeKey({
    userId: input.team.userId,
    teamId: input.team.id,
    period: currentPeriodKey(),
    scope: input.scope,
    agentId: input.agentId,
    toolName: input.toolName,
    threshold: input.threshold,
  });

  if (budgetAlerts.has(dedupeKey)) {
    return;
  }

  const alert: ControlPlaneBudgetAlert = {
    id: randomUUID(),
    userId: input.team.userId,
    teamId: input.team.id,
    agentId: input.agentId,
    toolName: input.toolName,
    scope: input.scope,
    threshold: input.threshold,
    budgetUsd: Number(input.budgetUsd.toFixed(2)),
    spentUsd: Number(input.spentUsd.toFixed(2)),
    recordedAt: nowIso(),
  };
  budgetAlerts.set(dedupeKey, alert);

  if (isPostgresConfigured()) {
    const workspaceId = teamWorkspaceIds.get(input.team.id);
    if (workspaceId) {
      await controlPlaneRepository.upsertBudgetAlert(
        { workspaceId, userId: input.team.userId },
        alert
      );
    }
  }
}

function pauseExecutionForBudget(agentId: string, executionId?: string): void {
  const timestamp = nowIso();
  if (executionId) {
    const execution = executions.get(executionId);
    if (execution && execution.status === "running") {
      execution.status = "blocked";
      execution.summary = execution.summary ?? "Execution halted after budget limit was reached.";
      execution.completedAt = timestamp;
      execution.lastHeartbeatAt = timestamp;
      executions.set(execution.id, execution);
    }
  }

  const agent = agents.get(agentId);
  if (agent) {
    agent.currentExecutionId = undefined;
    agent.lastHeartbeatAt = timestamp;
    agent.lastHeartbeatStatus = "blocked";
    agent.updatedAt = timestamp;
    agent.status = "paused";
    agents.set(agent.id, agent);
  }
}

async function applyBudgetPolicies(team: ControlPlaneTeam, agentId: string, executionId?: string): Promise<void> {
  const snapshot = buildTeamSpendSnapshot(team);
  const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agentId);

  for (const threshold of snapshot.team.alertThresholdsTriggered) {
    await upsertBudgetAlert({
      team,
      threshold,
      scope: "team",
      spentUsd: snapshot.team.spentUsd,
      budgetUsd: snapshot.team.budgetUsd,
    });
  }
  if (agentSnapshot) {
    for (const threshold of agentSnapshot.alertThresholdsTriggered) {
      await upsertBudgetAlert({
        team,
        threshold,
        scope: "agent",
        agentId,
        spentUsd: agentSnapshot.spentUsd,
        budgetUsd: agentSnapshot.budgetUsd,
      });
    }
  }
  for (const toolSnapshot of snapshot.tools) {
    for (const threshold of toolSnapshot.alertThresholdsTriggered) {
      await upsertBudgetAlert({
        team,
        threshold,
        scope: "tool",
        toolName: toolSnapshot.toolName,
        spentUsd: toolSnapshot.spentUsd,
        budgetUsd: toolSnapshot.budgetUsd,
        agentId,
      });
    }
  }

  if (snapshot.team.budgetUsd > 0 && snapshot.team.spentUsd >= snapshot.team.budgetUsd) {
    team.status = "paused";
    team.updatedAt = nowIso();
    teams.set(team.id, team);
    listAgentsForTeam(team.id, team.userId).forEach((teamAgent) => {
      if (teamAgent.status === "active") {
        teamAgent.status = "paused";
        teamAgent.updatedAt = nowIso();
        if (teamAgent.id === agentId) {
          pauseExecutionForBudget(teamAgent.id, executionId);
        } else {
          agents.set(teamAgent.id, teamAgent);
        }
      }
    });
    return;
  }

  if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
    pauseExecutionForBudget(agentId, executionId);
  }

  if (snapshot.tools.some((toolSnapshot) => toolSnapshot.budgetUsd > 0 && toolSnapshot.spentUsd >= toolSnapshot.budgetUsd)) {
    pauseExecutionForBudget(agentId, executionId);
  }
}

function assertExecutionAllowed(team: ControlPlaneTeam, agent: ControlPlaneAgent): void {
  const snapshot = buildTeamSpendSnapshot(team);
  const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agent.id);

  if (snapshot.team.budgetUsd > 0 && snapshot.team.spentUsd >= snapshot.team.budgetUsd) {
    team.status = "paused";
    teams.set(team.id, team);
    throw new Error("team_budget_exceeded");
  }

  if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
    agent.status = "paused";
    agents.set(agent.id, agent);
    throw new Error("agent_budget_exceeded");
  }
}

function createTeamRecord(input: {
  workspaceId?: string;
  userId: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
  deploymentMode?: ControlPlaneTeam["deploymentMode"];
  budgetMonthlyUsd?: number;
  toolBudgetCeilings?: Record<string, number>;
  alertThresholds?: number[];
  orchestrationEnabled?: boolean;
},
  persist = true
): ControlPlaneTeam {
  const timestamp = nowIso();
  const team: ControlPlaneTeam = {
    id: randomUUID(),
    userId: input.userId,
    name: input.name,
    description: input.description,
    workflowTemplateId: input.workflowTemplateId,
    workflowTemplateName: input.workflowTemplateName,
    deploymentMode: input.deploymentMode ?? "workflow_runtime",
    status: "active",
    restartCount: 0,
    budgetMonthlyUsd: input.budgetMonthlyUsd ?? 0,
    toolBudgetCeilings: { ...(input.toolBudgetCeilings ?? {}) },
    alertThresholds: input.alertThresholds?.length ? [...input.alertThresholds].sort((a, b) => a - b) : [0.8, 0.9, 1],
    orchestrationEnabled: input.orchestrationEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (persist) {
    teams.set(team.id, team);
  }
  if (input.workspaceId) {
    teamWorkspaceIds.set(team.id, input.workspaceId);
  }
  return team;
}

function createAgentRecord(
  input: Omit<ControlPlaneAgent, "id" | "createdAt" | "updatedAt">,
  persist = true
): ControlPlaneAgent {
  const timestamp = nowIso();
  const agent: ControlPlaneAgent = {
    ...input,
    skills: [...input.skills],
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (persist) {
    agents.set(agent.id, agent);
  }
  return agent;
}

function provisionStepAgent(input: {
  teamId: string;
  userId: string;
  step: WorkflowStep;
  budgetMonthlyUsd: number;
  reportingToAgentId?: string;
  defaultIntervalMinutes?: number;
  index?: number;
}): ControlPlaneAgent {
  return createAgentRecord({
    teamId: input.teamId,
    userId: input.userId,
    name: input.step.name,
    roleKey: inferRoleKey(input.step, input.index),
    workflowStepId: input.step.id,
    workflowStepKind: input.step.kind,
    model: input.step.agentModel ?? input.step.llmConfigId,
    instructions:
      input.step.agentInstructions ??
      input.step.description ??
      `Execute the ${input.step.kind} step ${input.step.name}.`,
    budgetMonthlyUsd: input.step.agentBudgetMonthlyUsd ?? input.budgetMonthlyUsd,
    reportingToAgentId: input.reportingToAgentId,
    skills: inferSkills(input.step),
    schedule:
      input.defaultIntervalMinutes && input.defaultIntervalMinutes > 0
        ? { type: "interval", intervalMinutes: input.defaultIntervalMinutes }
        : { type: "manual" },
    status: "active",
  });
}

function getAgentForWorkflowStep(teamId: string, userId: string, step: WorkflowStep): ControlPlaneAgent | undefined {
  const requestedRoleKey = inferRoleKey(step);
  return Array.from(agents.values()).find((agent) => {
    return (
      agent.userId === userId &&
      agent.teamId === teamId &&
      (agent.workflowStepId === step.id || agent.roleKey === requestedRoleKey)
    );
  });
}

function wasExecutionRequestedBeforePause(requestedAt: string, pausedAt?: string): boolean {
  if (!pausedAt) {
    return true;
  }
  return new Date(requestedAt).getTime() <= new Date(pausedAt).getTime();
}
export const controlPlaneStore = {
  async ensureWorkspaceHydrated(workspaceId: string | undefined, userId: string): Promise<void> {
    await ensureWorkspaceHydrated(workspaceId, userId);
  },

  listSkills(): ControlPlaneSkillDefinition[] {
    return SKILL_CATALOG.map((skill) => ({ ...skill }));
  },

  listRoleTemplates(): ControlPlaneRoleTemplateDefinition[] {
    return ROLE_TEMPLATE_CATALOG.map((template) => ({
      ...template,
      defaultSkills: [...template.defaultSkills],
    }));
  },

  async provisionCompanyWorkspace(input: {
    workspaceId?: string;
    userId: string;
    name: string;
    workspaceName?: string;
    externalCompanyId?: string;
    idempotencyKey: string;
    budgetMonthlyUsd: number;
    orchestrationEnabled?: boolean;
    secretBindings: Record<string, string>;
    agents: CompanyProvisioningAgentInput[];
  }): Promise<CompanyProvisioningResult> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const normalizedName = input.name.trim();
    const normalizedWorkspaceName = input.workspaceName?.trim() || `${normalizedName} Workspace`;
    const normalizedIdempotencyKey = input.idempotencyKey.trim();
    const normalizedExternalCompanyId = input.externalCompanyId?.trim() || undefined;
    const fingerprint = serializeProvisioningFingerprint({
      name: normalizedName,
      workspaceName: normalizedWorkspaceName,
      externalCompanyId: normalizedExternalCompanyId,
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      orchestrationEnabled: input.orchestrationEnabled,
      secretBindings: input.secretBindings,
      agents: input.agents,
    });
    const idempotencyIndexKey = `${input.userId}:${normalizedIdempotencyKey}`;
    const existingProvisioning = companyIdempotencyIndex.get(idempotencyIndexKey);
    if (existingProvisioning) {
      if (existingProvisioning.fingerprint && existingProvisioning.fingerprint !== fingerprint) {
        throw new Error("idempotency_conflict");
      }

      const company = getProvisionedCompanyOwnedByUser(existingProvisioning.companyId, input.userId);
      const workspace = company ? companyWorkspaces.get(company.workspaceId) : undefined;
      const team = company ? getTeamOwnedByUser(company.teamId, input.userId) : undefined;
      if (!company || !workspace || !team) {
        throw new Error("idempotency_target_missing");
      }

      const replaySummaries = isPostgresConfigured()
        ? await secretsRepository.listSecretSummaries(
            {
              workspaceId: requireWorkspaceIdForPersistence(input.workspaceId),
              userId: input.userId,
              actorUserId: input.userId,
            },
            company.id
          )
        : buildCompanySecretSummaries(companySecretBindings.get(company.id) ?? {});

      return {
        company: { ...company },
        workspace: { ...workspace },
        team: { ...team },
        agents: this.listAgents(team.id, input.userId),
        secretBindings: replaySummaries,
        availableSkills: this.listSkills(),
        idempotentReplay: true,
      };
    }

    const roleTemplateUsage = new Map<string, number>();
    const resolvedRoleTemplates = input.agents.map((agentInput) => {
      const roleTemplate = getRoleTemplateById(agentInput.roleTemplateId);
      if (!roleTemplate) {
        throw new Error(`unknown_role_template:${agentInput.roleTemplateId}`);
      }
      if (agentInput.skills) {
        ensureValidSkillIds(agentInput.skills);
      }
      return roleTemplate;
    });
    const explicitBudget = input.agents.reduce((sum, agent) => sum + (agent.budgetMonthlyUsd ?? 0), 0);
    if (explicitBudget > input.budgetMonthlyUsd) {
      throw new Error("budget_exceeded");
    }
    const agentsWithoutBudget = input.agents.filter((agent) => agent.budgetMonthlyUsd === undefined);
    const remainingBudgetPool = Number((input.budgetMonthlyUsd - explicitBudget).toFixed(2));
    const perAgentBudget =
      agentsWithoutBudget.length > 0
        ? Number((remainingBudgetPool / agentsWithoutBudget.length).toFixed(2))
        : 0;

    const team = createTeamRecord({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: normalizedWorkspaceName,
      description: `Provisioned company workspace for ${normalizedName}`,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      orchestrationEnabled: input.orchestrationEnabled ?? true,
    }, false);

    const provisionedAgents = input.agents.map((agentInput, index) => {
      const roleTemplate = resolvedRoleTemplates[index];
      const usageCount = roleTemplateUsage.get(roleTemplate.id) ?? 0;
      roleTemplateUsage.set(roleTemplate.id, usageCount + 1);
      return createAgentRecord({
        teamId: team.id,
        userId: input.userId,
        name: agentInput.name?.trim() || roleTemplate.name,
        roleKey: makeProvisioningRoleKey(roleTemplate.id, usageCount),
        model: agentInput.model?.trim() || roleTemplate.defaultModel,
        instructions: agentInput.instructions?.trim() || roleTemplate.defaultInstructions,
        budgetMonthlyUsd:
          agentInput.budgetMonthlyUsd !== undefined ? agentInput.budgetMonthlyUsd : perAgentBudget,
        reportingToAgentId: undefined,
        skills: mergeSkills(roleTemplate.defaultSkills, agentInput.skills),
        schedule: { type: "manual" },
        status: "active",
      }, false);
    });

    const allocatedBudgetMonthlyUsd = Number(
      provisionedAgents.reduce((sum, agent) => sum + agent.budgetMonthlyUsd, 0).toFixed(2)
    );
    if (allocatedBudgetMonthlyUsd > input.budgetMonthlyUsd) {
      throw new Error("budget_exceeded");
    }

    const timestamp = nowIso();
    const workspaceId = input.workspaceId?.trim() || randomUUID();
    const existingWorkspace = companyWorkspaces.get(workspaceId);
    const workspace: ProvisionedCompanyWorkspace = {
      id: workspaceId,
      name: normalizedWorkspaceName,
      slug: slugify(normalizedName),
      createdAt: existingWorkspace?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const company: ProvisionedCompanyRecord = {
      id: randomUUID(),
      userId: input.userId,
      name: normalizedName,
      externalCompanyId: normalizedExternalCompanyId,
      workspaceId: workspace.id,
      teamId: team.id,
      idempotencyKey: normalizedIdempotencyKey,
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      allocatedBudgetMonthlyUsd,
      remainingBudgetMonthlyUsd: Number((input.budgetMonthlyUsd - allocatedBudgetMonthlyUsd).toFixed(2)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    teams.set(team.id, team);
    provisionedAgents.forEach((agent) => {
      agents.set(agent.id, agent);
    });
    companies.set(company.id, company);
    companyWorkspaces.set(workspace.id, workspace);
    if (!isPostgresConfigured()) {
      companySecretBindings.set(company.id, { ...input.secretBindings });
    }
    companyIdempotencyIndex.set(idempotencyIndexKey, { companyId: company.id, fingerprint });
    teamCompanyIds.set(team.id, company.id);

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
        for (const agent of provisionedAgents) {
          await upsertAgentRow(agent, workspaceId, client);
        }
        await upsertProvisionedCompanyRow({
          company,
          workspace,
          tenantWorkspaceId: workspaceId,
          client,
        });
      });
      await secretsRepository.setSecrets(
        { workspaceId, userId: input.userId, actorUserId: input.userId },
        company.id,
        input.secretBindings
      );
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return {
      company: { ...company },
      workspace: { ...workspace },
      team: { ...team },
      agents: provisionedAgents.map((agent) => ({ ...agent, skills: [...agent.skills] })),
      secretBindings: buildCompanySecretSummaries(input.secretBindings),
      availableSkills: this.listSkills(),
      idempotentReplay: false,
    };
  },

  async createTeam(input: {
    workspaceId?: string;
    userId: string;
    name: string;
    description?: string;
    workflowTemplateId?: string;
    workflowTemplateName?: string;
    deploymentMode?: ControlPlaneTeam["deploymentMode"];
    budgetMonthlyUsd?: number;
    toolBudgetCeilings?: Record<string, number>;
    alertThresholds?: number[];
    orchestrationEnabled?: boolean;
  }): Promise<ControlPlaneTeam> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const team = createTeamRecord(input);
    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }
    return team;
  },

  listTeams(userId: string, workspaceId?: string): ControlPlaneTeam[] {
    const accessibleTeamIds = listAccessibleTeamIds(userId, workspaceId);
    return Array.from(teams.values())
      .filter((team) => accessibleTeamIds.has(team.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  getTeam(teamId: string, userId: string, workspaceId?: string): ControlPlaneTeam | undefined {
    const team = teams.get(teamId);
    return canAccessTeam(team, userId, workspaceId) ? team : undefined;
  },

  getMissionState(teamId: string, userId: string, workspaceId?: string): ControlPlaneMissionState | undefined {
    const team = teams.get(teamId);
    if (!canAccessTeam(team, userId, workspaceId)) {
      return undefined;
    }

    return buildMissionState(team);
  },

  listAgents(teamId: string, userId: string, workspaceId?: string): ControlPlaneAgent[] {
    const team = teams.get(teamId);
    if (!canAccessTeam(team, userId, workspaceId)) {
      return [];
    }
    return Array.from(agents.values())
      .filter((agent) => agent.teamId === teamId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  listAllAgents(userId: string, workspaceId?: string): ControlPlaneAgent[] {
    const accessibleTeamIds = listAccessibleTeamIds(userId, workspaceId);
    return Array.from(agents.values())
      .filter((agent) => accessibleTeamIds.has(agent.teamId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  getAgent(agentId: string, userId: string, workspaceId?: string): ControlPlaneAgent | undefined {
    const agent = agents.get(agentId);
    return canAccessAgent(agent, userId, workspaceId) ? agent : undefined;
  },

  listExecutions(userId: string, teamId?: string, workspaceId?: string): ControlPlaneExecution[] {
    const accessibleTeamIds = listAccessibleTeamIds(userId, workspaceId);
    return Array.from(executions.values())
      .filter((execution) => accessibleTeamIds.has(execution.teamId) && (!teamId || execution.teamId === teamId))
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  },

  listAgentExecutions(agentId: string, userId: string, workspaceId?: string): ControlPlaneExecution[] {
    const agent = agents.get(agentId);
    if (!canAccessAgent(agent, userId, workspaceId)) {
      return [];
    }
    return Array.from(executions.values())
      .filter((execution) => execution.agentId === agentId)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  },

  listAgentHeartbeats(agentId: string, userId: string, workspaceId?: string): AgentHeartbeatRecord[] {
    const agent = agents.get(agentId);
    if (!canAccessAgent(agent, userId, workspaceId)) {
      return [];
    }
    return Array.from(heartbeats.values())
      .filter((heartbeat) => heartbeat.agentId === agentId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  },

  listSpendEntries(userId: string, filters?: {
    teamId?: string;
    agentId?: string;
    executionId?: string;
    period?: string;
  }): ControlPlaneSpendEntry[] {
    return Array.from(spendEntries.values())
      .filter((entry) => {
        if (entry.userId !== userId) return false;
        if (filters?.teamId && entry.teamId !== filters.teamId) return false;
        if (filters?.agentId && entry.agentId !== filters.agentId) return false;
        if (filters?.executionId && entry.executionId !== filters.executionId) return false;
        if (filters?.period && !entry.recordedAt.startsWith(filters.period)) return false;
        return true;
      })
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  },

  listBudgetAlerts(userId: string, teamId?: string): ControlPlaneBudgetAlert[] {
    return Array.from(budgetAlerts.values())
      .filter((alert) => alert.userId === userId && (!teamId || alert.teamId === teamId))
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  },

  getTeamSpendSnapshot(teamId: string, userId: string, workspaceId?: string): TeamSpendSnapshot | undefined {
    const team = teams.get(teamId);
    if (!canAccessTeam(team, userId, workspaceId)) {
      return undefined;
    }
    return buildTeamSpendSnapshot(team);
  },

  async deployWorkflowAsTeam(input: {
    workspaceId?: string;
    userId: string;
    template: WorkflowTemplate;
    teamName?: string;
    budgetMonthlyUsd?: number;
    toolBudgetCeilings?: Record<string, number>;
    alertThresholds?: number[];
    defaultIntervalMinutes?: number;
  }): Promise<ControlPlaneDeployment> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const actionableSteps = input.template.steps.filter(
      (step) => !["trigger", "cron_trigger", "interval_trigger", "output"].includes(step.kind)
    );
    const teamBudget = input.budgetMonthlyUsd ?? 0;
    const team = createTeamRecord({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.teamName?.trim() || `${input.template.name} Control Plane`,
      description: `Agent team deployed from workflow template ${input.template.name}`,
      workflowTemplateId: input.template.id,
      workflowTemplateName: input.template.name,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: teamBudget,
      toolBudgetCeilings: input.toolBudgetCeilings,
      alertThresholds: input.alertThresholds,
      orchestrationEnabled: true,
    });

    const managerBudget = teamBudget > 0 ? Number((teamBudget * 0.2).toFixed(2)) : 0;
    const workerBudgetPool = Math.max(0, teamBudget - managerBudget);
    const perWorkerBudget =
      actionableSteps.length > 0 ? Number((workerBudgetPool / actionableSteps.length).toFixed(2)) : 0;

    const manager = createAgentRecord({
      teamId: team.id,
      userId: input.userId,
      name: `${input.template.name} Manager`,
      roleKey: "workflow-manager",
      instructions: `Coordinate the deployed workflow ${input.template.name}, manage task handoffs, and maintain the audit trail.`,
      budgetMonthlyUsd: managerBudget,
      reportingToAgentId: undefined,
      skills: ["paperclip"],
      schedule: { type: "manual" },
      status: "active",
    });

    actionableSteps.forEach((step, index) => {
      provisionStepAgent({
        teamId: team.id,
        userId: input.userId,
        step,
        budgetMonthlyUsd: perWorkerBudget,
        reportingToAgentId: manager.id,
        defaultIntervalMinutes: input.defaultIntervalMinutes,
        index,
      });
    });

    if (actionableSteps.length === 0) {
      createAgentRecord({
        teamId: team.id,
        userId: input.userId,
        name: "General Operator",
        roleKey: "general-operator",
        instructions: `Execute operational work for ${input.template.name} when no step-specific agent mapping exists.`,
        budgetMonthlyUsd: workerBudgetPool,
        reportingToAgentId: manager.id,
        skills: ["paperclip"],
        schedule:
          input.defaultIntervalMinutes && input.defaultIntervalMinutes > 0
            ? { type: "interval", intervalMinutes: input.defaultIntervalMinutes }
            : { type: "manual" },
        status: "active",
      });
    }

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
        for (const agent of this.listAgents(team.id, input.userId)) {
          await upsertAgentRow(agent, workspaceId, client);
        }
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return {
      team,
      agents: this.listAgents(team.id, input.userId),
      workflow: {
        id: input.template.id,
        name: input.template.name,
        category: input.template.category,
        version: input.template.version,
      },
      availableSkills: this.listSkills(),
    };
  },

  async ensureRuntimeTeamForStep(input: {
    workspaceId?: string;
    userId: string;
    step: WorkflowStep;
    teamName?: string;
    actor: string;
  }): Promise<{ team: ControlPlaneTeam; agent: ControlPlaneAgent }> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const requestedTeamName = input.teamName?.trim() || `${input.step.name} Runtime Team`;
    let team = Array.from(teams.values()).find(
      (candidate) =>
        candidate.userId === input.userId &&
        candidate.name === requestedTeamName &&
        candidate.deploymentMode === "continuous_agents"
    );

    if (!team) {
      team = createTeamRecord({
        workspaceId: input.workspaceId,
        userId: input.userId,
        name: requestedTeamName,
        description: `Runtime deployment bridge for workflow step ${input.step.name}`,
        deploymentMode: "continuous_agents",
        alertThresholds: [0.8, 0.9, 1],
        orchestrationEnabled: true,
      });
    }

    let agent = getAgentForWorkflowStep(team.id, input.userId, input.step);
    if (!agent) {
      agent = provisionStepAgent({
        teamId: team.id,
        userId: input.userId,
        step: input.step,
        budgetMonthlyUsd: input.step.agentBudgetMonthlyUsd ?? 0,
      });
    }

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team!, workspaceId, client);
        await upsertAgentRow(agent!, workspaceId, client);
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return { team, agent };
  },

  async updateTeamLifecycle(input: {
    workspaceId?: string;
    teamId: string;
    userId: string;
    action: ControlPlaneLifecycleAction;
  }): Promise<ControlPlaneTeam> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    const timestamp = nowIso();
    switch (input.action) {
      case "pause":
        team.status = "paused";
        team.pausedByCompanyLifecycle = false;
        break;
      case "resume":
      case "restart":
        team.status = "active";
        team.pausedByCompanyLifecycle = false;
        break;
      case "stop":
        team.status = "stopped";
        team.pausedByCompanyLifecycle = false;
        break;
    }

    if (input.action === "restart") {
      team.restartCount += 1;
    }
    team.updatedAt = timestamp;

    this.listAgents(team.id, input.userId).forEach((agent) => {
      agent.status = toAgentStatus(input.action);
      agent.pausedByCompanyLifecycle = false;
      agent.updatedAt = timestamp;
      if (input.action === "stop") {
        agent.currentExecutionId = undefined;
      }
    });

    if (input.action === "stop") {
      this.listExecutions(input.userId, team.id)
        .filter((execution) => execution.status === "queued" || execution.status === "running")
        .forEach((execution) => {
          execution.status = "stopped";
          execution.completedAt = timestamp;
          execution.lastHeartbeatAt = timestamp;
        });
    }

    if (input.action === "restart") {
      this.listExecutions(input.userId, team.id)
        .filter((execution) => execution.status === "failed" || execution.status === "stopped")
        .forEach((execution) => {
          execution.status = "queued";
          execution.restartCount += 1;
          execution.completedAt = undefined;
          execution.startedAt = undefined;
          execution.lastHeartbeatAt = timestamp;
        });
    }

    teams.set(team.id, team);
    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
        for (const agent of this.listAgents(team.id, input.userId)) {
          await upsertAgentRow(agent, workspaceId, client);
        }
        for (const execution of this.listExecutions(input.userId, team.id)) {
          await upsertExecutionRow(execution, workspaceId, client);
        }
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }
    return team;
  },

  async updateAgentSkills(input: {
    workspaceId?: string;
    agentId: string;
    userId: string;
    operation: "assign" | "revoke";
    skills: string[];
  }): Promise<ControlPlaneAgent> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const agent = getAgentOwnedByUser(input.agentId, input.userId);
    if (!agent) {
      throw new Error("agent_not_found");
    }

    ensureValidSkillIds(input.skills);

    const current = new Set(agent.skills);
    input.skills.forEach((skill) => {
      if (input.operation === "assign") {
        current.add(skill);
      } else {
        current.delete(skill);
      }
    });
    agent.skills = Array.from(current.values()).sort();
    agent.updatedAt = nowIso();
    agents.set(agent.id, agent);

    this.listExecutions(input.userId, agent.teamId)
      .filter((execution) => execution.agentId === agent.id && execution.status === "running")
      .forEach((execution) => {
        execution.appliedSkills = [...agent.skills];
        execution.lastHeartbeatAt = nowIso();
      });

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertAgentRow(agent, workspaceId, client);
        for (const execution of this.listExecutions(input.userId, agent.teamId).filter(
          (candidate) => candidate.agentId === agent.id && candidate.status === "running"
        )) {
          await upsertExecutionRow(execution, workspaceId, client);
        }
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return agent;
  },

  async createTask(input: {
    userId: string;
    teamId: string;
    title: string;
    description?: string;
    sourceRunId?: string;
    sourceWorkflowStepId?: string;
    assignedAgentId?: string;
    metadata?: Record<string, unknown>;
    actor: string;
  }): Promise<ControlPlaneTask> {
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    if (input.assignedAgentId) {
      const agent = getAgentOwnedByUser(input.assignedAgentId, input.userId);
      if (!agent || agent.teamId !== team.id) {
        throw new Error("agent_not_found");
      }
    }

    const timestamp = nowIso();
    const task: ControlPlaneTask = {
      id: randomUUID(),
      teamId: input.teamId,
      userId: input.userId,
      title: input.title,
      description: input.description,
      sourceRunId: input.sourceRunId,
      sourceWorkflowStepId: input.sourceWorkflowStepId,
      assignedAgentId: input.assignedAgentId,
      status: "todo",
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      auditTrail: [buildAuditEvent("created", input.actor, "Task created with status todo")],
    };
    tasks.set(task.id, task);
    const taskCtx = workspaceContextForTeam(task.teamId, input.userId);
    if (taskCtx) {
      await controlPlaneRepository.upsertTask(taskCtx, task);
    }
    observabilityStore.record({
      userId: input.userId,
      category: "issue",
      type: "issue.created",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task created: ${task.title}`,
      payload: {
        status: task.status,
        sourceRunId: task.sourceRunId,
        sourceWorkflowStepId: task.sourceWorkflowStepId,
        metadata: task.metadata,
      },
      occurredAt: task.createdAt,
    });
    return task;
  },

  listTasks(userId: string, teamId?: string, workspaceId?: string): ControlPlaneTask[] {
    const accessibleTeamIds = listAccessibleTeamIds(userId, workspaceId);
    return Array.from(tasks.values())
      .filter((task) => accessibleTeamIds.has(task.teamId) && (!teamId || task.teamId === teamId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  async checkoutTask(input: {
    taskId: string;
    userId: string;
    actor: string;
  }): Promise<ControlPlaneTask> {
    const task = tasks.get(input.taskId);
    if (!task || task.userId !== input.userId) {
      throw new Error("task_not_found");
    }
    if (task.checkedOutBy && task.checkedOutBy !== input.actor) {
      throw new Error("task_checked_out");
    }

    const timestamp = nowIso();
    task.checkedOutBy = input.actor;
    task.checkedOutAt = timestamp;
    task.status = "in_progress";
    task.updatedAt = timestamp;
    task.auditTrail.push(
      buildAuditEvent("checked_out", input.actor, `Task checked out by ${input.actor}`)
    );
    tasks.set(task.id, task);
    const taskCtx = workspaceContextForTeam(task.teamId, input.userId);
    if (taskCtx) {
      await controlPlaneRepository.upsertTask(taskCtx, task);
    }
    observabilityStore.record({
      userId: input.userId,
      category: "issue",
      type: "issue.status_changed",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task moved to ${task.status}`,
      payload: {
        previousStatus: "todo",
        status: task.status,
        sourceRunId: task.sourceRunId,
        sourceWorkflowStepId: task.sourceWorkflowStepId,
        metadata: task.metadata,
      },
      occurredAt: task.updatedAt,
    });
    return task;
  },

  async updateTaskStatus(input: {
    taskId: string;
    userId: string;
    actor: string;
    status: ControlPlaneTaskStatus;
  }): Promise<ControlPlaneTask> {
    const task = tasks.get(input.taskId);
    if (!task || task.userId !== input.userId) {
      throw new Error("task_not_found");
    }

    const previousStatus = task.status;
    task.status = input.status;
    task.updatedAt = nowIso();
    task.auditTrail.push(
      buildAuditEvent("status_changed", input.actor, `Task status changed to ${input.status}`)
    );
    tasks.set(task.id, task);
    const taskCtx = workspaceContextForTeam(task.teamId, input.userId);
    if (taskCtx) {
      await controlPlaneRepository.upsertTask(taskCtx, task);
    }
    observabilityStore.record({
      userId: input.userId,
      category: "issue",
      type: "issue.status_changed",
      actor: inferObservabilityActor(input.actor),
      subject: {
        type: "task",
        id: task.id,
        label: task.title,
        parentType: "team",
        parentId: task.teamId,
      },
      summary: `Task moved to ${task.status}`,
      payload: {
        previousStatus,
        status: task.status,
        sourceRunId: task.sourceRunId,
        sourceWorkflowStepId: task.sourceWorkflowStepId,
        metadata: task.metadata,
      },
      occurredAt: task.updatedAt,
    });
    return task;
  },

  async updateCompanyLifecycle(input: {
    userId: string;
    action: "pause" | "resume";
    actor: string;
    reason?: string;
  }): Promise<{
    state: Awaited<ReturnType<typeof companyLifecycleStore.getState>>;
    auditEntry: Awaited<ReturnType<typeof companyLifecycleStore.applyAction>>["auditEntry"];
    affectedTeamIds: string[];
    affectedAgentIds: string[];
  }> {
    const timestamp = nowIso();
    const affectedTeamIds: string[] = [];
    const affectedAgentIds: string[] = [];

    Array.from(teams.values())
      .filter((team) => team.userId === input.userId)
      .forEach((team) => {
        if (input.action === "pause") {
          if (team.status === "active") {
            team.status = "paused";
            team.pausedByCompanyLifecycle = true;
            team.updatedAt = timestamp;
            affectedTeamIds.push(team.id);
          }
          return;
        }

        if (team.status === "paused" && team.pausedByCompanyLifecycle) {
          team.status = "active";
          team.pausedByCompanyLifecycle = false;
          team.updatedAt = timestamp;
          affectedTeamIds.push(team.id);
        }
      });

    Array.from(agents.values())
      .filter((agent) => agent.userId === input.userId)
      .forEach((agent) => {
        if (input.action === "pause") {
          if (agent.status === "active") {
            agent.status = "paused";
            agent.pausedByCompanyLifecycle = true;
            agent.updatedAt = timestamp;
            affectedAgentIds.push(agent.id);
          }
          return;
        }

        if (agent.status === "paused" && agent.pausedByCompanyLifecycle) {
          agent.status = "active";
          agent.pausedByCompanyLifecycle = false;
          agent.updatedAt = timestamp;
          affectedAgentIds.push(agent.id);
        }
      });

    const { state, auditEntry } = await companyLifecycleStore.applyAction({
      userId: input.userId,
      action: input.action,
      runId: input.actor,
      reason: input.reason,
      affectedTeamIds,
      affectedAgentIds,
    });

    return { state, auditEntry, affectedTeamIds, affectedAgentIds };
  },

  async getCompanyLifecycle(userId: string) {
    return companyLifecycleStore.getState(userId);
  },

  async listCompanyLifecycleAudit(userId: string) {
    return companyLifecycleStore.listAudit(userId);
  },

  async recordSpend(input: {
    userId: string;
    teamId: string;
    agentId: string;
    executionId?: string;
    category: SpendCategory;
    costUsd: number;
    model?: string;
    provider?: string;
    toolName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ControlPlaneSpendEntry> {
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    const agent = getAgentOwnedByUser(input.agentId, input.userId);
    if (!team || !agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    if (input.executionId) {
      const execution = getExecutionOwnedByUser(input.executionId, input.userId);
      if (!execution || execution.teamId !== team.id || execution.agentId !== agent.id) {
        throw new Error("execution_not_found");
      }
    }

    const toolBudget = input.toolName ? team.toolBudgetCeilings[input.toolName] ?? 0 : 0;
    const snapshot = buildTeamSpendSnapshot(team);
    const teamWouldExceed =
      team.budgetMonthlyUsd > 0 && snapshot.team.spentUsd >= team.budgetMonthlyUsd;
    const agentSnapshot = snapshot.agents.find((entry) => entry.agentId === agent.id);
    const agentWouldExceed =
      !!agentSnapshot && agent.budgetMonthlyUsd > 0 && agentSnapshot.spentUsd >= agent.budgetMonthlyUsd;
    const toolSnapshot = input.toolName
      ? snapshot.tools.find((entry) => entry.toolName === input.toolName)
      : undefined;
    const toolWouldExceed =
      !!toolSnapshot && toolBudget > 0 && toolSnapshot.spentUsd >= toolBudget;

    if (teamWouldExceed) throw new Error("team_budget_exceeded");
    if (agentWouldExceed) throw new Error("agent_budget_exceeded");
    if (toolWouldExceed) throw new Error("tool_budget_exceeded");

    const entry: ControlPlaneSpendEntry = {
      id: randomUUID(),
      teamId: input.teamId,
      agentId: input.agentId,
      executionId: input.executionId,
      userId: input.userId,
      category: input.category,
      costUsd: Number(input.costUsd.toFixed(4)),
      model: input.model,
      provider: input.provider,
      toolName: input.toolName,
      metadata: input.metadata,
      recordedAt: nowIso(),
    };
    spendEntries.set(entry.id, entry);
    const spendCtx = workspaceContextForTeam(input.teamId, input.userId);
    if (spendCtx) {
      await controlPlaneRepository.insertSpendEntry(spendCtx, entry);
    }
    await applyBudgetPolicies(team, agent.id, input.executionId);
    return entry;
  },

  async startAgentExecution(input: {
    workspaceId?: string;
    userId: string;
    actor: string;
    teamId: string;
    step: WorkflowStep;
    sourceRunId: string;
    metadata?: Record<string, unknown>;
    requestedAgentId?: string;
    taskTitle?: string;
    taskDescription?: string;
  }): Promise<{ execution: ControlPlaneExecution; agent: ControlPlaneAgent; task?: ControlPlaneTask }> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    if (await companyLifecycleStore.isPaused(input.userId)) {
      throw new Error("company_paused");
    }

    const team = getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    const agent =
      (input.requestedAgentId ? getAgentOwnedByUser(input.requestedAgentId, input.userId) : undefined) ??
      getAgentForWorkflowStep(input.teamId, input.userId, input.step);
    if (!agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    assertAgentWorkspaceBinding({
      agentId: agent.id,
      agentTeamId: agent.teamId,
      resolvedTeamId: team.id,
      teamWorkspaceId: teamWorkspaceIds.get(team.id),
      claimedWorkspaceId: input.workspaceId,
    });

    const teamSnapshot = buildTeamSpendSnapshot(team);
    const agentSnapshot = teamSnapshot.agents.find((entry) => entry.agentId === agent.id);
    if (team.status !== "active") {
      if (teamSnapshot.team.budgetUsd > 0 && teamSnapshot.team.spentUsd >= teamSnapshot.team.budgetUsd) {
        throw new Error("team_budget_exceeded");
      }
      throw new Error("team_not_active");
    }
    if (agent.status !== "active") {
      if (agentSnapshot && agentSnapshot.budgetUsd > 0 && agentSnapshot.spentUsd >= agentSnapshot.budgetUsd) {
        throw new Error("agent_budget_exceeded");
      }
      throw new Error("agent_not_active");
    }
    assertExecutionAllowed(team, agent);

    const task =
      input.taskTitle && input.taskTitle.trim()
        ? await this.createTask({
            userId: input.userId,
            teamId: team.id,
            title: input.taskTitle.trim(),
            description: input.taskDescription,
            sourceRunId: input.sourceRunId,
            sourceWorkflowStepId: input.step.id,
            assignedAgentId: agent.id,
            metadata: input.metadata,
            actor: input.actor,
          })
        : undefined;

    const requestedAt = nowIso();
    const execution: ControlPlaneExecution = {
      id: randomUUID(),
      teamId: team.id,
      agentId: agent.id,
      userId: input.userId,
      sourceRunId: input.sourceRunId,
      sourceWorkflowStepId: input.step.id,
      sourceWorkflowStepName: input.step.name,
      taskId: task?.id,
      status: "running",
      appliedSkills: [...agent.skills],
      metadata: input.metadata,
      requestedAt,
      startedAt: requestedAt,
      lastHeartbeatAt: requestedAt,
      restartCount: 0,
    };
    executions.set(execution.id, execution);

    agent.currentExecutionId = execution.id;
    agent.lastHeartbeatAt = requestedAt;
    agent.lastHeartbeatStatus = "running";
    normalizeAgentStatusForSuccessfulHeartbeat(agent, "running");
    agent.updatedAt = requestedAt;

    team.lastHeartbeatAt = requestedAt;
    team.updatedAt = requestedAt;

    await this.recordHeartbeat({
      workspaceId: input.workspaceId,
      userId: input.userId,
      teamId: team.id,
      agentId: agent.id,
      executionId: execution.id,
      status: "running",
      summary: `Started workflow step ${input.step.name}`,
      createdTaskIds: task ? [task.id] : [],
    });

    observabilityStore.record({
      userId: input.userId,
      category: "run",
      type: "run.started",
      actor: { type: "agent", id: agent.id, label: agent.name },
      subject: {
        type: "execution",
        id: execution.id,
        label: input.step.name,
        parentType: "team",
        parentId: team.id,
      },
      summary: `Started workflow step ${input.step.name}`,
      payload: {
        status: "running",
        sourceRunId: input.sourceRunId,
        workflowStepId: input.step.id,
        workflowStepName: input.step.name,
        taskId: task?.id,
        metadata: input.metadata,
      },
      occurredAt: execution.requestedAt,
    });

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
        await upsertAgentRow(agent, workspaceId, client);
        await upsertExecutionRow(execution, workspaceId, client);
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return { execution, agent, task };
  },

  async finalizeAgentExecution(input: {
    workspaceId?: string;
    executionId: string;
    userId: string;
    status: Exclude<ControlPlaneExecutionStatus, "queued" | "running">;
    summary?: string;
    costUsd?: number;
    spendEntries?: Array<{
      category: SpendCategory;
      costUsd: number;
      model?: string;
      provider?: string;
      toolName?: string;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<ControlPlaneExecution> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const execution = getExecutionOwnedByUser(input.executionId, input.userId);
    if (!execution) {
      throw new Error("execution_not_found");
    }

    const timestamp = nowIso();
    execution.status = input.status;
    execution.summary = input.summary;
    execution.costUsd = input.costUsd;
    execution.lastHeartbeatAt = timestamp;
    execution.completedAt = timestamp;
    executions.set(execution.id, execution);

    const agent = agents.get(execution.agentId);
    if (agent) {
      agent.currentExecutionId = undefined;
      agent.lastHeartbeatAt = timestamp;
      agent.lastHeartbeatStatus = toHeartbeatStatus(input.status);
      normalizeAgentStatusForSuccessfulHeartbeat(agent, agent.lastHeartbeatStatus);
      agent.updatedAt = timestamp;
    }

    const team = teams.get(execution.teamId);
    if (team) {
      team.lastHeartbeatAt = timestamp;
      team.updatedAt = timestamp;
    }

    if (Array.isArray(input.spendEntries) && input.spendEntries.length > 0) {
      for (const entry of input.spendEntries) {
        await this.recordSpend({
          userId: input.userId,
          teamId: execution.teamId,
          agentId: execution.agentId,
          executionId: execution.id,
          category: entry.category,
          costUsd: entry.costUsd,
          model: entry.model,
          provider: entry.provider,
          toolName: entry.toolName,
          metadata: entry.metadata,
        });
      }
    } else if (typeof input.costUsd === "number" && input.costUsd > 0) {
      await this.recordSpend({
        userId: input.userId,
        teamId: execution.teamId,
        agentId: execution.agentId,
        executionId: execution.id,
        category: "compute",
        costUsd: input.costUsd,
        metadata: { source: "execution_finalize" },
      });
    }

    void this.recordHeartbeat({
      workspaceId: input.workspaceId,
      userId: input.userId,
      teamId: execution.teamId,
      agentId: execution.agentId,
      executionId: execution.id,
      status: toHeartbeatStatus(input.status),
      summary: input.summary,
      costUsd: input.costUsd,
      completedAt: timestamp,
    });

    observabilityStore.record({
      userId: input.userId,
      category: "run",
      type: `run.${input.status}`,
      actor: { type: "agent", id: execution.agentId, label: agent?.name },
      subject: {
        type: "execution",
        id: execution.id,
        label: execution.sourceWorkflowStepName,
        parentType: "team",
        parentId: execution.teamId,
      },
      summary: input.summary ?? `Execution ${input.status}`,
      payload: {
        status: input.status,
        sourceRunId: execution.sourceRunId,
        workflowStepId: execution.sourceWorkflowStepId,
        workflowStepName: execution.sourceWorkflowStepName,
        taskId: execution.taskId,
        costUsd: input.costUsd,
        metadata: execution.metadata,
      },
      occurredAt: timestamp,
    });

    if (input.status === "blocked" || input.status === "failed") {
      observabilityStore.record({
        userId: input.userId,
        category: "alert",
        type: "alert.triggered",
        actor: { type: "agent", id: execution.agentId, label: agent?.name },
        subject: {
          type: "execution",
          id: execution.id,
          label: execution.sourceWorkflowStepName,
          parentType: "team",
          parentId: execution.teamId,
        },
        summary: input.summary ?? `Execution ${input.status}`,
        payload: {
          severity: input.status === "failed" ? "critical" : "warning",
          code: input.status === "failed" ? "run_failed" : "run_blocked",
          sourceCategory: "run",
          sourceId: execution.id,
          executionId: execution.id,
        },
        occurredAt: timestamp,
      });
    }

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        if (team) {
          await upsertTeamRow(team, workspaceId, client);
        }
        if (agent) {
          await upsertAgentRow(agent, workspaceId, client);
        }
        await upsertExecutionRow(execution, workspaceId, client);
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return execution;
  },

  async updateExecutionLifecycle(input: {
    workspaceId?: string;
    executionId: string;
    userId: string;
    action: Extract<ControlPlaneLifecycleAction, "restart" | "stop">;
  }): Promise<ControlPlaneExecution> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const execution = getExecutionOwnedByUser(input.executionId, input.userId);
    if (!execution) {
      throw new Error("execution_not_found");
    }

    const timestamp = nowIso();
    if (input.action === "stop") {
      execution.status = "stopped";
      execution.completedAt = timestamp;
    } else {
      execution.status = "queued";
      execution.startedAt = undefined;
      execution.completedAt = undefined;
      execution.restartCount += 1;
    }
    execution.lastHeartbeatAt = timestamp;
    executions.set(execution.id, execution);
    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertExecutionRow(execution, workspaceId, client);
      });
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }
    return execution;
  },

  async recordHeartbeat(input: {
    workspaceId?: string;
    userId: string;
    teamId: string;
    agentId: string;
    executionId?: string;
    status: AgentHeartbeatRecord["status"];
    summary?: string;
    costUsd?: number;
    spendEntries?: Array<{
      category: SpendCategory;
      costUsd: number;
      model?: string;
      provider?: string;
      toolName?: string;
      metadata?: Record<string, unknown>;
    }>;
    createdTaskIds?: string[];
    completedAt?: string;
  }): Promise<AgentHeartbeatRecord> {
    await ensureWorkspaceHydrated(input.workspaceId, input.userId);
    const companyState = await companyLifecycleStore.getState(input.userId);
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    const agent = getAgentOwnedByUser(input.agentId, input.userId);
    if (!team || !agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }

    let execution = input.executionId
      ? getExecutionOwnedByUser(input.executionId, input.userId)
      : undefined;

    if (input.executionId) {
      if (!execution || execution.teamId !== team.id || execution.agentId !== agent.id) {
        throw new Error("execution_not_found");
      }
    }

    if (companyState.status === "paused") {
      const canProceed =
        execution && wasExecutionRequestedBeforePause(execution.requestedAt, companyState.pausedAt);
      if (!canProceed) {
        throw new Error("company_paused");
      }
    }

    if (execution) {
      execution.lastHeartbeatAt = nowIso();
      executions.set(execution.id, execution);
    }

    const timestamp = nowIso();
    team.lastHeartbeatAt = timestamp;
    team.updatedAt = timestamp;
    agent.lastHeartbeatAt = timestamp;
    agent.lastHeartbeatStatus = input.status;
    normalizeAgentStatusForSuccessfulHeartbeat(agent, input.status);
    agent.updatedAt = timestamp;

    const heartbeat: AgentHeartbeatRecord = {
      id: randomUUID(),
      teamId: input.teamId,
      agentId: input.agentId,
      executionId: input.executionId,
      userId: input.userId,
      status: input.status,
      summary: input.summary,
      costUsd: input.costUsd,
      createdTaskIds: input.createdTaskIds ?? [],
      startedAt: timestamp,
      completedAt: input.completedAt,
    };
    heartbeats.set(heartbeat.id, heartbeat);

    if (Array.isArray(input.spendEntries) && input.spendEntries.length > 0) {
      for (const entry of input.spendEntries) {
        await this.recordSpend({
          userId: input.userId,
          teamId: input.teamId,
          agentId: input.agentId,
          executionId: input.executionId,
          category: entry.category,
          costUsd: entry.costUsd,
          model: entry.model,
          provider: entry.provider,
          toolName: entry.toolName,
          metadata: entry.metadata,
        });
      }
    } else if (typeof input.costUsd === "number" && input.costUsd > 0) {
      await this.recordSpend({
        userId: input.userId,
        teamId: input.teamId,
        agentId: input.agentId,
        executionId: input.executionId,
        category: "compute",
        costUsd: input.costUsd,
        metadata: { source: "heartbeat" },
      });
    }

    observabilityStore.record({
      userId: input.userId,
      category: "heartbeat",
      type: "heartbeat.recorded",
      actor: { type: "agent", id: agent.id, label: agent.name },
      subject: {
        type: "agent",
        id: agent.id,
        label: agent.name,
        parentType: "team",
        parentId: team.id,
      },
      summary: input.summary ?? `Heartbeat ${input.status}`,
      payload: {
        status: input.status,
        executionId: input.executionId,
        createdTaskIds: input.createdTaskIds ?? [],
        costUsd: input.costUsd,
      },
      occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
    });

    if (typeof input.costUsd === "number" && input.costUsd > 0) {
      observabilityStore.record({
        userId: input.userId,
        category: "budget",
        type: "budget.spent",
        actor: { type: "agent", id: agent.id, label: agent.name },
        subject: {
          type: "agent",
          id: agent.id,
          label: agent.name,
          parentType: "team",
          parentId: team.id,
        },
        summary: `Recorded $${input.costUsd.toFixed(2)} spend for ${agent.name}`,
        payload: {
          deltaUsd: input.costUsd,
          executionId: input.executionId,
          period: (heartbeat.completedAt ?? heartbeat.startedAt).slice(0, 7),
        },
        occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
      });
    }

    if (input.status === "blocked") {
      observabilityStore.record({
        userId: input.userId,
        category: "alert",
        type: "alert.triggered",
        actor: { type: "agent", id: agent.id, label: agent.name },
        subject: {
          type: "agent",
          id: agent.id,
          label: agent.name,
          parentType: "team",
          parentId: team.id,
        },
        summary: input.summary ?? `${agent.name} heartbeat blocked`,
        payload: {
          severity: "warning",
          code: "heartbeat_blocked",
          sourceCategory: "heartbeat",
          sourceId: heartbeat.id,
          executionId: input.executionId,
        },
        occurredAt: heartbeat.completedAt ?? heartbeat.startedAt,
      });
    }

    if (isPostgresConfigured()) {
      const workspaceId = requireWorkspaceIdForPersistence(input.workspaceId);
      await withWorkspaceContext(getPostgresPool(), { workspaceId, userId: input.userId }, async (client) => {
        await upsertTeamRow(team, workspaceId, client);
        await upsertAgentRow(agent, workspaceId, client);
        if (execution) {
          await upsertExecutionRow(execution, workspaceId, client);
        }
      });
      await controlPlaneRepository.insertHeartbeat({ workspaceId, userId: input.userId }, heartbeat);
      hydratedWorkspaceUsers.add(workspaceUserKey(workspaceId, input.userId));
    }

    return heartbeat;
  },

  listHeartbeats(userId: string, teamId?: string, workspaceId?: string): AgentHeartbeatRecord[] {
    const accessibleTeamIds = listAccessibleTeamIds(userId, workspaceId);
    return Array.from(heartbeats.values())
      .filter((heartbeat) => accessibleTeamIds.has(heartbeat.teamId) && (!teamId || heartbeat.teamId === teamId))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  },

  clear(): void {
    teams.clear();
    agents.clear();
    tasks.clear();
    heartbeats.clear();
    executions.clear();
    companies.clear();
    companyWorkspaces.clear();
    companySecretBindings.clear();
    companyIdempotencyIndex.clear();
    companyLifecycleStore.clear();
    spendEntries.clear();
    budgetAlerts.clear();
    teamWorkspaceIds.clear();
    teamCompanyIds.clear();
    companyTenantWorkspaceIds.clear();
    hydratedWorkspaceUsers.clear();
  },
};

export function resetControlPlaneStoreForTests(): void {
  controlPlaneStore.clear();
}
