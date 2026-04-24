import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";

const router = express.Router();

type DashboardAgentStatus = "running" | "paused" | "idle" | "error";
type DashboardRunStatus = "queued" | "running" | "completed" | "failed" | "blocked";

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function currentPeriodKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function toDashboardAgentStatus(
  status: "active" | "paused" | "terminated",
  lastHeartbeatStatus?: "queued" | "running" | "completed" | "blocked"
): DashboardAgentStatus {
  if (status === "paused") return "paused";
  if (status === "terminated") return "idle";
  if (lastHeartbeatStatus === "blocked") return "error";
  if (lastHeartbeatStatus === "running") return "running";
  return "idle";
}

function toDashboardHeartbeatStatus(
  status: "queued" | "running" | "completed" | "blocked"
): DashboardAgentStatus {
  if (status === "running") return "running";
  if (status === "blocked") return "error";
  return "idle";
}

function toDashboardRunStatus(
  status: "queued" | "running" | "completed" | "blocked" | "failed" | "stopped"
): DashboardRunStatus {
  if (status === "stopped") return "failed";
  return status;
}

router.get("/", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const teams = new Map(controlPlaneStore.listTeams(userId).map((team) => [team.id, team]));
  const agents = controlPlaneStore.listAllAgents(userId).map((agent) => {
    const team = teams.get(agent.teamId);
    const executions = controlPlaneStore.listAgentExecutions(agent.id, userId);
    const lastExecution = executions.at(-1);
    return {
      id: agent.id,
      userId: agent.userId,
      name: agent.name,
      description: team?.description ?? null,
      roleKey: agent.roleKey,
      model: agent.model ?? null,
      instructions: agent.instructions,
      status: toDashboardAgentStatus(agent.status, agent.lastHeartbeatStatus),
      budgetMonthlyUsd: agent.budgetMonthlyUsd,
      metadata: {
        teamId: agent.teamId,
        teamName: team?.name ?? null,
        reportingToAgentId: agent.reportingToAgentId ?? null,
        workflowStepId: agent.workflowStepId ?? null,
        workflowStepKind: agent.workflowStepKind ?? null,
      },
      lastHeartbeatAt: agent.lastHeartbeatAt ?? null,
      lastRunAt: lastExecution?.completedAt ?? lastExecution?.startedAt ?? null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  });

  res.json({ agents, total: agents.length });
});

router.get("/:id/heartbeat", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, userId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const heartbeat = controlPlaneStore.listAgentHeartbeats(agent.id, userId).at(-1);
  if (!heartbeat) {
    res.status(404).json({ error: "Heartbeat not found" });
    return;
  }

  res.json({
    id: heartbeat.id,
    agentId: heartbeat.agentId,
    userId: heartbeat.userId,
    status: toDashboardHeartbeatStatus(heartbeat.status),
    summary: heartbeat.summary ?? null,
    tokenUsage: 0,
    costUsd: heartbeat.costUsd ?? 0,
    runId: heartbeat.executionId ?? null,
    createdByRunId: heartbeat.executionId ?? "control-plane",
    recordedAt: heartbeat.completedAt ?? heartbeat.startedAt,
  });
});

router.get("/:id/runs", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, userId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const runs = controlPlaneStore.listAgentExecutions(agent.id, userId).map((execution) => ({
    id: execution.id,
    agentId: execution.agentId,
    userId: execution.userId,
    runId: execution.sourceRunId,
    status: toDashboardRunStatus(execution.status),
    summary: execution.summary ?? null,
    tokenUsage: 0,
    costUsd: execution.costUsd ?? 0,
    startedAt: execution.startedAt ?? execution.requestedAt,
    completedAt: execution.completedAt ?? null,
    createdByRunId: execution.sourceRunId,
    createdAt: execution.requestedAt,
  }));

  res.json({ runs, total: runs.length });
});

router.get("/:id/budget", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, userId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const period = currentPeriodKey();
  const heartbeats = controlPlaneStore.listAgentHeartbeats(agent.id, userId);
  const spentUsd = Number(
    heartbeats
      .filter((heartbeat) => (heartbeat.completedAt ?? heartbeat.startedAt).startsWith(period))
      .reduce((sum, heartbeat) => sum + (heartbeat.costUsd ?? 0), 0)
      .toFixed(2)
  );
  const monthlyUsd = agent.budgetMonthlyUsd;
  const remainingUsd = Number(Math.max(0, monthlyUsd - spentUsd).toFixed(2));
  const lastUpdatedAt = heartbeats.at(-1)?.completedAt ?? heartbeats.at(-1)?.startedAt ?? agent.updatedAt;

  res.json({
    agentId: agent.id,
    userId: agent.userId,
    monthlyUsd,
    spentUsd,
    remainingUsd,
    currentPeriod: period,
    autoPaused: agent.status === "paused" && monthlyUsd > 0 && spentUsd >= monthlyUsd,
    lastUpdatedAt,
  });
});

router.get("/:id/token-usage", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, userId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const parsedDays = Number.parseInt(String(req.query.days ?? "30"), 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

  const dailyCosts = new Map<string, number>();
  for (const heartbeat of controlPlaneStore.listAgentHeartbeats(agent.id, userId)) {
    const timestamp = heartbeat.completedAt ?? heartbeat.startedAt;
    if (new Date(timestamp) < cutoff) {
      continue;
    }

    const date = timestamp.slice(0, 10);
    dailyCosts.set(date, Number(((dailyCosts.get(date) ?? 0) + (heartbeat.costUsd ?? 0)).toFixed(2)));
  }

  const daily = Array.from(dailyCosts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, costUsd]) => ({
      date,
      tokens: 0,
      costUsd,
    }));

  res.json({
    agentId: agent.id,
    userId: agent.userId,
    days,
    totalTokens: 0,
    totalCostUsd: Number(daily.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(2)),
    daily,
  });
});

export default router;
