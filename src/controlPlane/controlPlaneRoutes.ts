import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { getTemplate } from "../templates";
import { controlPlaneStore } from "./controlPlaneStore";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function requirePaperclipRunId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId || !runId.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating control-plane requests" });
    return;
  }
  next();
}

router.get("/teams", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const teams = controlPlaneStore.listTeams(userId);
  res.json({ teams, total: teams.length });
});

router.post("/teams", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { name, description, budgetMonthlyUsd, deploymentMode, orchestrationEnabled } = req.body as {
    name?: unknown;
    description?: unknown;
    budgetMonthlyUsd?: unknown;
    deploymentMode?: unknown;
    orchestrationEnabled?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required and must be a non-empty string" });
    return;
  }

  if (budgetMonthlyUsd !== undefined && (typeof budgetMonthlyUsd !== "number" || budgetMonthlyUsd < 0)) {
    res.status(400).json({ error: "budgetMonthlyUsd must be a non-negative number when provided" });
    return;
  }

  const team = controlPlaneStore.createTeam({
    userId,
    name: name.trim(),
    description: typeof description === "string" ? description : undefined,
    budgetMonthlyUsd: typeof budgetMonthlyUsd === "number" ? budgetMonthlyUsd : undefined,
    deploymentMode:
      deploymentMode === "workflow_runtime" || deploymentMode === "continuous_agents"
        ? deploymentMode
        : undefined,
    orchestrationEnabled:
      typeof orchestrationEnabled === "boolean" ? orchestrationEnabled : undefined,
  });

  res.status(201).json(team);
});

router.post("/deployments/workflow", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { templateId, teamName, budgetMonthlyUsd, defaultIntervalMinutes } = req.body as {
    templateId?: unknown;
    teamName?: unknown;
    budgetMonthlyUsd?: unknown;
    defaultIntervalMinutes?: unknown;
  };

  if (typeof templateId !== "string" || !templateId.trim()) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  if (budgetMonthlyUsd !== undefined && (typeof budgetMonthlyUsd !== "number" || budgetMonthlyUsd < 0)) {
    res.status(400).json({ error: "budgetMonthlyUsd must be a non-negative number when provided" });
    return;
  }

  if (
    defaultIntervalMinutes !== undefined &&
    (typeof defaultIntervalMinutes !== "number" || defaultIntervalMinutes <= 0)
  ) {
    res.status(400).json({ error: "defaultIntervalMinutes must be a positive number when provided" });
    return;
  }

  try {
    const template = getTemplate(templateId);
    const deployment = controlPlaneStore.deployWorkflowAsTeam({
      userId,
      template,
      teamName: typeof teamName === "string" ? teamName : undefined,
      budgetMonthlyUsd: typeof budgetMonthlyUsd === "number" ? budgetMonthlyUsd : undefined,
      defaultIntervalMinutes:
        typeof defaultIntervalMinutes === "number" ? defaultIntervalMinutes : undefined,
    });
    res.status(201).json(deployment);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
  }
});

router.get("/teams/:id", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const team = controlPlaneStore.getTeam(req.params.id, userId);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const agents = controlPlaneStore.listAgents(team.id, userId);
  const tasks = controlPlaneStore.listTasks(userId, team.id);
  const heartbeats = controlPlaneStore.listHeartbeats(userId, team.id);
  res.json({ team, agents, tasks, heartbeats });
});

router.post("/tasks", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { teamId, title, description, sourceRunId, sourceWorkflowStepId, assignedAgentId, metadata } =
    req.body as {
      teamId?: unknown;
      title?: unknown;
      description?: unknown;
      sourceRunId?: unknown;
      sourceWorkflowStepId?: unknown;
      assignedAgentId?: unknown;
      metadata?: unknown;
    };

  if (typeof teamId !== "string" || !teamId.trim()) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const task = controlPlaneStore.createTask({
      userId,
      teamId,
      title: title.trim(),
      description: typeof description === "string" ? description : undefined,
      sourceRunId: typeof sourceRunId === "string" ? sourceRunId : undefined,
      sourceWorkflowStepId: typeof sourceWorkflowStepId === "string" ? sourceWorkflowStepId : undefined,
      assignedAgentId: typeof assignedAgentId === "string" ? assignedAgentId : undefined,
      metadata:
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : undefined,
      actor: req.header("X-Paperclip-Run-Id") as string,
    });
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "team_not_found") {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Assigned agent not found for team" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane task creation failure" });
  }
});

router.get("/tasks", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  const tasks = controlPlaneStore.listTasks(userId, teamId);
  res.json({ tasks, total: tasks.length });
});

router.post("/tasks/:id/checkout", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const task = controlPlaneStore.checkoutTask({
      taskId: req.params.id,
      userId,
      actor: req.header("X-Paperclip-Run-Id") as string,
    });
    res.json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "task_not_found") {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (error instanceof Error && error.message === "task_checked_out") {
      res.status(409).json({ error: "Task is already checked out by another run" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane checkout failure" });
  }
});

router.patch("/tasks/:id/status", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { status } = req.body as { status?: unknown };
  if (status !== "todo" && status !== "in_progress" && status !== "done" && status !== "blocked") {
    res.status(400).json({ error: "status must be one of todo, in_progress, done, or blocked" });
    return;
  }

  try {
    const task = controlPlaneStore.updateTaskStatus({
      taskId: req.params.id,
      userId,
      actor: req.header("X-Paperclip-Run-Id") as string,
      status,
    });
    res.json(task);
  } catch (error) {
    if (error instanceof Error && error.message === "task_not_found") {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane task update failure" });
  }
});

router.post("/heartbeats", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { teamId, agentId, status, summary, costUsd, createdTaskIds, completedAt } = req.body as {
    teamId?: unknown;
    agentId?: unknown;
    status?: unknown;
    summary?: unknown;
    costUsd?: unknown;
    createdTaskIds?: unknown;
    completedAt?: unknown;
  };

  if (typeof teamId !== "string" || !teamId.trim()) {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof agentId !== "string" || !agentId.trim()) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (status !== "queued" && status !== "running" && status !== "completed" && status !== "blocked") {
    res.status(400).json({ error: "status must be one of queued, running, completed, or blocked" });
    return;
  }
  if (costUsd !== undefined && (typeof costUsd !== "number" || costUsd < 0)) {
    res.status(400).json({ error: "costUsd must be a non-negative number when provided" });
    return;
  }
  if (createdTaskIds !== undefined && !Array.isArray(createdTaskIds)) {
    res.status(400).json({ error: "createdTaskIds must be an array when provided" });
    return;
  }

  try {
    const heartbeat = controlPlaneStore.recordHeartbeat({
      userId,
      teamId,
      agentId,
      status,
      summary: typeof summary === "string" ? summary : undefined,
      costUsd: typeof costUsd === "number" ? costUsd : undefined,
      createdTaskIds: Array.isArray(createdTaskIds)
        ? createdTaskIds.filter((entry): entry is string => typeof entry === "string")
        : undefined,
      completedAt: typeof completedAt === "string" ? completedAt : undefined,
    });
    res.status(201).json(heartbeat);
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") {
      res.status(404).json({ error: "Agent not found for team" });
      return;
    }
    res.status(500).json({ error: "Unexpected control-plane heartbeat failure" });
  }
});

router.get("/heartbeats", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  const heartbeats = controlPlaneStore.listHeartbeats(userId, teamId);
  res.json({ heartbeats, total: heartbeats.length });
});

export default router;
