import { randomUUID } from "crypto";
import { WorkflowStep, WorkflowTemplate } from "../types/workflow";
import {
  AgentHeartbeatRecord,
  CompanyProvisioningAgentInput,
  CompanyProvisioningResult,
  ControlPlaneAgent,
  ControlPlaneDeployment,
  ControlPlaneExecution,
  ControlPlaneExecutionStatus,
  ControlPlaneLifecycleAction,
  ControlPlaneRoleTemplateDefinition,
  ControlPlaneSkillDefinition,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
  HeartbeatStatus,
  ProvisionedCompanyRecord,
  ProvisionedCompanySecretBinding,
  ProvisionedCompanyWorkspace,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

const SKILL_CATALOG: ControlPlaneSkillDefinition[] = [
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

const ROLE_TEMPLATE_CATALOG: ControlPlaneRoleTemplateDefinition[] = [
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

const teams = new Map<string, ControlPlaneTeam>();
const agents = new Map<string, ControlPlaneAgent>();
const tasks = new Map<string, ControlPlaneTask>();
const heartbeats = new Map<string, AgentHeartbeatRecord>();
const executions = new Map<string, ControlPlaneExecution>();
const companies = new Map<string, ProvisionedCompanyRecord>();
const companyWorkspaces = new Map<string, ProvisionedCompanyWorkspace>();
const companySecretBindings = new Map<string, Record<string, string>>();
const companyIdempotencyIndex = new Map<string, { companyId: string; fingerprint: string }>();

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

function createTeamRecord(input: {
  userId: string;
  name: string;
  description?: string;
  workflowTemplateId?: string;
  workflowTemplateName?: string;
  deploymentMode?: ControlPlaneTeam["deploymentMode"];
  budgetMonthlyUsd?: number;
  orchestrationEnabled?: boolean;
}): ControlPlaneTeam {
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
    orchestrationEnabled: input.orchestrationEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  teams.set(team.id, team);
  return team;
}

function createAgentRecord(input: Omit<ControlPlaneAgent, "id" | "createdAt" | "updatedAt">): ControlPlaneAgent {
  const timestamp = nowIso();
  const agent: ControlPlaneAgent = {
    ...input,
    skills: [...input.skills],
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  agents.set(agent.id, agent);
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

function listAgentsForTeam(teamId: string, userId: string): ControlPlaneAgent[] {
  return Array.from(agents.values())
    .filter((agent) => agent.userId === userId && agent.teamId === teamId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export const controlPlaneStore = {
  listSkills(): ControlPlaneSkillDefinition[] {
    return SKILL_CATALOG.map((skill) => ({ ...skill }));
  },

  listRoleTemplates(): ControlPlaneRoleTemplateDefinition[] {
    return ROLE_TEMPLATE_CATALOG.map((template) => ({
      ...template,
      defaultSkills: [...template.defaultSkills],
    }));
  },

  provisionCompanyWorkspace(input: {
    userId: string;
    name: string;
    workspaceName?: string;
    externalCompanyId?: string;
    idempotencyKey: string;
    budgetMonthlyUsd: number;
    orchestrationEnabled?: boolean;
    secretBindings: Record<string, string>;
    agents: CompanyProvisioningAgentInput[];
  }): CompanyProvisioningResult {
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
      if (existingProvisioning.fingerprint !== fingerprint) {
        throw new Error("idempotency_conflict");
      }

      const company = getProvisionedCompanyOwnedByUser(existingProvisioning.companyId, input.userId);
      const workspace = company ? companyWorkspaces.get(company.workspaceId) : undefined;
      const team = company ? getTeamOwnedByUser(company.teamId, input.userId) : undefined;
      if (!company || !workspace || !team) {
        throw new Error("idempotency_target_missing");
      }

      return {
        company: { ...company },
        workspace: { ...workspace },
        team: { ...team },
        agents: this.listAgents(team.id, input.userId),
        secretBindings: buildCompanySecretSummaries(companySecretBindings.get(company.id) ?? {}),
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
      userId: input.userId,
      name: normalizedWorkspaceName,
      description: `Provisioned company workspace for ${normalizedName}`,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: input.budgetMonthlyUsd,
      orchestrationEnabled: input.orchestrationEnabled ?? true,
    });

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
      });
    });

    const allocatedBudgetMonthlyUsd = Number(
      provisionedAgents.reduce((sum, agent) => sum + agent.budgetMonthlyUsd, 0).toFixed(2)
    );
    if (allocatedBudgetMonthlyUsd > input.budgetMonthlyUsd) {
      throw new Error("budget_exceeded");
    }

    const timestamp = nowIso();
    const workspace: ProvisionedCompanyWorkspace = {
      id: randomUUID(),
      name: normalizedWorkspaceName,
      slug: slugify(normalizedName),
      createdAt: timestamp,
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

    companies.set(company.id, company);
    companyWorkspaces.set(workspace.id, workspace);
    companySecretBindings.set(company.id, { ...input.secretBindings });
    companyIdempotencyIndex.set(idempotencyIndexKey, { companyId: company.id, fingerprint });

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

  createTeam(input: {
    userId: string;
    name: string;
    description?: string;
    workflowTemplateId?: string;
    workflowTemplateName?: string;
    deploymentMode?: ControlPlaneTeam["deploymentMode"];
    budgetMonthlyUsd?: number;
    orchestrationEnabled?: boolean;
  }): ControlPlaneTeam {
    return createTeamRecord(input);
  },

  listTeams(userId: string): ControlPlaneTeam[] {
    return Array.from(teams.values())
      .filter((team) => team.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  getTeam(teamId: string, userId: string): ControlPlaneTeam | undefined {
    return getTeamOwnedByUser(teamId, userId);
  },

  listAgents(teamId: string, userId: string): ControlPlaneAgent[] {
    return listAgentsForTeam(teamId, userId);
  },

  listAllAgents(userId: string): ControlPlaneAgent[] {
    return Array.from(agents.values())
      .filter((agent) => agent.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  getAgent(agentId: string, userId: string): ControlPlaneAgent | undefined {
    return getAgentOwnedByUser(agentId, userId);
  },

  listExecutions(userId: string, teamId?: string): ControlPlaneExecution[] {
    return Array.from(executions.values())
      .filter((execution) => execution.userId === userId && (!teamId || execution.teamId === teamId))
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  },

  listAgentExecutions(agentId: string, userId: string): ControlPlaneExecution[] {
    return Array.from(executions.values())
      .filter((execution) => execution.userId === userId && execution.agentId === agentId)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  },

  listAgentHeartbeats(agentId: string, userId: string): AgentHeartbeatRecord[] {
    return Array.from(heartbeats.values())
      .filter((heartbeat) => heartbeat.userId === userId && heartbeat.agentId === agentId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  },

  deployWorkflowAsTeam(input: {
    userId: string;
    template: WorkflowTemplate;
    teamName?: string;
    budgetMonthlyUsd?: number;
    defaultIntervalMinutes?: number;
  }): ControlPlaneDeployment {
    const actionableSteps = input.template.steps.filter(
      (step) => !["trigger", "cron_trigger", "interval_trigger", "output"].includes(step.kind)
    );
    const teamBudget = input.budgetMonthlyUsd ?? 0;
    const team = createTeamRecord({
      userId: input.userId,
      name: input.teamName?.trim() || `${input.template.name} Control Plane`,
      description: `Agent team deployed from workflow template ${input.template.name}`,
      workflowTemplateId: input.template.id,
      workflowTemplateName: input.template.name,
      deploymentMode: "continuous_agents",
      budgetMonthlyUsd: teamBudget,
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

  ensureRuntimeTeamForStep(input: {
    userId: string;
    step: WorkflowStep;
    teamName?: string;
    actor: string;
  }): { team: ControlPlaneTeam; agent: ControlPlaneAgent } {
    const requestedTeamName = input.teamName?.trim() || `${input.step.name} Runtime Team`;
    let team = Array.from(teams.values()).find(
      (candidate) =>
        candidate.userId === input.userId &&
        candidate.name === requestedTeamName &&
        candidate.deploymentMode === "continuous_agents"
    );

    if (!team) {
      team = createTeamRecord({
        userId: input.userId,
        name: requestedTeamName,
        description: `Runtime deployment bridge for workflow step ${input.step.name}`,
        deploymentMode: "continuous_agents",
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

    return { team, agent };
  },

  updateTeamLifecycle(input: {
    teamId: string;
    userId: string;
    action: ControlPlaneLifecycleAction;
  }): ControlPlaneTeam {
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }

    const timestamp = nowIso();
    switch (input.action) {
      case "pause":
        team.status = "paused";
        break;
      case "resume":
      case "restart":
        team.status = "active";
        break;
      case "stop":
        team.status = "stopped";
        break;
    }

    if (input.action === "restart") {
      team.restartCount += 1;
    }
    team.updatedAt = timestamp;

    this.listAgents(team.id, input.userId).forEach((agent) => {
      agent.status = toAgentStatus(input.action);
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
    return team;
  },

  updateAgentSkills(input: {
    agentId: string;
    userId: string;
    operation: "assign" | "revoke";
    skills: string[];
  }): ControlPlaneAgent {
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

    return agent;
  },

  createTask(input: {
    userId: string;
    teamId: string;
    title: string;
    description?: string;
    sourceRunId?: string;
    sourceWorkflowStepId?: string;
    assignedAgentId?: string;
    metadata?: Record<string, unknown>;
    actor: string;
  }): ControlPlaneTask {
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
    return task;
  },

  listTasks(userId: string, teamId?: string): ControlPlaneTask[] {
    return Array.from(tasks.values())
      .filter((task) => task.userId === userId && (!teamId || task.teamId === teamId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  checkoutTask(input: {
    taskId: string;
    userId: string;
    actor: string;
  }): ControlPlaneTask {
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
    return task;
  },

  updateTaskStatus(input: {
    taskId: string;
    userId: string;
    actor: string;
    status: ControlPlaneTaskStatus;
  }): ControlPlaneTask {
    const task = tasks.get(input.taskId);
    if (!task || task.userId !== input.userId) {
      throw new Error("task_not_found");
    }

    task.status = input.status;
    task.updatedAt = nowIso();
    task.auditTrail.push(
      buildAuditEvent("status_changed", input.actor, `Task status changed to ${input.status}`)
    );
    tasks.set(task.id, task);
    return task;
  },

  startAgentExecution(input: {
    userId: string;
    actor: string;
    teamId: string;
    step: WorkflowStep;
    sourceRunId: string;
    metadata?: Record<string, unknown>;
    requestedAgentId?: string;
    taskTitle?: string;
    taskDescription?: string;
  }): { execution: ControlPlaneExecution; agent: ControlPlaneAgent; task?: ControlPlaneTask } {
    const team = getTeamOwnedByUser(input.teamId, input.userId);
    if (!team) {
      throw new Error("team_not_found");
    }
    if (team.status !== "active") {
      throw new Error("team_not_active");
    }

    const agent =
      (input.requestedAgentId ? getAgentOwnedByUser(input.requestedAgentId, input.userId) : undefined) ??
      getAgentForWorkflowStep(input.teamId, input.userId, input.step);
    if (!agent || agent.teamId !== team.id) {
      throw new Error("agent_not_found");
    }
    if (agent.status !== "active") {
      throw new Error("agent_not_active");
    }

    const task =
      input.taskTitle && input.taskTitle.trim()
        ? this.createTask({
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
    agent.updatedAt = requestedAt;

    team.lastHeartbeatAt = requestedAt;
    team.updatedAt = requestedAt;

    this.recordHeartbeat({
      userId: input.userId,
      teamId: team.id,
      agentId: agent.id,
      executionId: execution.id,
      status: "running",
      summary: `Started workflow step ${input.step.name}`,
      createdTaskIds: task ? [task.id] : [],
    });

    return { execution, agent, task };
  },

  finalizeAgentExecution(input: {
    executionId: string;
    userId: string;
    status: Exclude<ControlPlaneExecutionStatus, "queued" | "running">;
    summary?: string;
    costUsd?: number;
  }): ControlPlaneExecution {
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
      agent.updatedAt = timestamp;
    }

    const team = teams.get(execution.teamId);
    if (team) {
      team.lastHeartbeatAt = timestamp;
      team.updatedAt = timestamp;
    }

    this.recordHeartbeat({
      userId: input.userId,
      teamId: execution.teamId,
      agentId: execution.agentId,
      executionId: execution.id,
      status: toHeartbeatStatus(input.status),
      summary: input.summary,
      costUsd: input.costUsd,
      completedAt: timestamp,
    });

    return execution;
  },

  updateExecutionLifecycle(input: {
    executionId: string;
    userId: string;
    action: Extract<ControlPlaneLifecycleAction, "restart" | "stop">;
  }): ControlPlaneExecution {
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
    return execution;
  },

  recordHeartbeat(input: {
    userId: string;
    teamId: string;
    agentId: string;
    executionId?: string;
    status: AgentHeartbeatRecord["status"];
    summary?: string;
    costUsd?: number;
    createdTaskIds?: string[];
    completedAt?: string;
  }): AgentHeartbeatRecord {
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
      execution.lastHeartbeatAt = nowIso();
      executions.set(execution.id, execution);
    }

    const timestamp = nowIso();
    team.lastHeartbeatAt = timestamp;
    team.updatedAt = timestamp;
    agent.lastHeartbeatAt = timestamp;
    agent.lastHeartbeatStatus = input.status;
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
    return heartbeat;
  },

  listHeartbeats(userId: string, teamId?: string): AgentHeartbeatRecord[] {
    return Array.from(heartbeats.values())
      .filter((heartbeat) => heartbeat.userId === userId && (!teamId || heartbeat.teamId === teamId))
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
  },
};
