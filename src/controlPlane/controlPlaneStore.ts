import { randomUUID } from "crypto";
import { WorkflowTemplate } from "../types/workflow";
import {
  AgentHeartbeatRecord,
  ControlPlaneAgent,
  ControlPlaneDeployment,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
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

const teams = new Map<string, ControlPlaneTeam>();
const agents = new Map<string, ControlPlaneAgent>();
const tasks = new Map<string, ControlPlaneTask>();
const heartbeats = new Map<string, AgentHeartbeatRecord>();

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
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  agents.set(agent.id, agent);
  return agent;
}

export const controlPlaneStore = {
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
    return Array.from(agents.values())
      .filter((agent) => agent.userId === userId && agent.teamId === teamId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
      schedule: { type: "manual" },
      status: "active",
    });

    const workerAgents = actionableSteps.map((step, index) =>
      createAgentRecord({
        teamId: team.id,
        userId: input.userId,
        name: step.name,
        roleKey: `${slugify(step.kind)}-${index + 1}`,
        workflowStepId: step.id,
        workflowStepKind: step.kind,
        model: step.agentModel ?? step.llmConfigId,
        instructions:
          step.agentInstructions ??
          step.description ??
          `Execute the ${step.kind} step ${step.name} inside ${input.template.name}.`,
        budgetMonthlyUsd: perWorkerBudget,
        reportingToAgentId: manager.id,
        schedule:
          input.defaultIntervalMinutes && input.defaultIntervalMinutes > 0
            ? { type: "interval", intervalMinutes: input.defaultIntervalMinutes }
            : { type: "manual" },
        status: "active",
      })
    );

    if (workerAgents.length === 0) {
      createAgentRecord({
        teamId: team.id,
        userId: input.userId,
        name: "General Operator",
        roleKey: "general-operator",
        instructions: `Execute operational work for ${input.template.name} when no step-specific agent mapping exists.`,
        budgetMonthlyUsd: workerBudgetPool,
        reportingToAgentId: manager.id,
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
    };
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
      auditTrail: [
        buildAuditEvent("created", input.actor, `Task created with status todo`),
      ],
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

  recordHeartbeat(input: {
    userId: string;
    teamId: string;
    agentId: string;
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

    const heartbeat: AgentHeartbeatRecord = {
      id: randomUUID(),
      teamId: input.teamId,
      agentId: input.agentId,
      userId: input.userId,
      status: input.status,
      summary: input.summary,
      costUsd: input.costUsd,
      createdTaskIds: input.createdTaskIds ?? [],
      startedAt: nowIso(),
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
  },
};
