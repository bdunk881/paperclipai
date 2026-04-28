import { randomUUID } from "crypto";
import { WorkflowStep, WorkflowTemplate } from "../types/workflow";
import {
  AgentHeartbeatRecord,
  ControlPlaneAgent,
  ControlPlaneDeployment,
  ControlPlaneExecution,
  ControlPlaneExecutionStatus,
  ControlPlaneLifecycleAction,
  ControlPlaneSkillDefinition,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  ControlPlaneTeam,
  HeartbeatStatus,
} from "./types";
import { observabilityStore } from "../observability/store";

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

const teams = new Map<string, ControlPlaneTeam>();
const agents = new Map<string, ControlPlaneAgent>();
const tasks = new Map<string, ControlPlaneTask>();
const heartbeats = new Map<string, AgentHeartbeatRecord>();
const executions = new Map<string, ControlPlaneExecution>();

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

    const validSkillIds = new Set(SKILL_CATALOG.map((skill) => skill.id));
    const invalidSkills = input.skills.filter((skill) => !validSkillIds.has(skill));
    if (invalidSkills.length > 0) {
      throw new Error(`invalid_skills:${invalidSkills.join(",")}`);
    }

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

    const previousStatus = task.status;
    task.status = input.status;
    task.updatedAt = nowIso();
    task.auditTrail.push(
      buildAuditEvent("status_changed", input.actor, `Task status changed to ${input.status}`)
    );
    tasks.set(task.id, task);
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
  },
};
