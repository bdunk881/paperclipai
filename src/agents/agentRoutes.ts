import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function mapAgentStatus(status: string): string {
  switch (status) {
    case "active":
      return "running";
    case "paused":
      return "paused";
    case "terminated":
      return "error";
    default:
      return "idle";
  }
}

/** GET /api/agents — list all agents for the authenticated user */
router.get("/", (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agents = controlPlaneStore.listAllAgents(userId).map((agent) => ({
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    description: null,
    roleKey: agent.roleKey,
    model: agent.model ?? null,
    instructions: agent.instructions,
    status: mapAgentStatus(agent.status),
    budgetMonthlyUsd: agent.budgetMonthlyUsd,
    metadata: {},
    lastHeartbeatAt: agent.lastHeartbeatAt ?? null,
    lastRunAt: agent.lastHeartbeatAt ?? null,
    reportingToAgentId: agent.reportingToAgentId ?? null,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }));

  res.json({ agents });
});

/** GET /api/agents/:id/heartbeat — latest heartbeat for an agent */
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

  const heartbeats = controlPlaneStore
    .listHeartbeats(userId, agent.teamId)
    .filter((hb) => hb.agentId === agent.id);

  const latest = heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;
  if (!latest) {
    res.status(404).json({ error: "No heartbeat found" });
    return;
  }

  res.json({
    id: latest.id,
    agentId: latest.agentId,
    userId: latest.userId,
    status: mapAgentStatus(agent.status),
    summary: latest.summary ?? null,
    tokenUsage: 0,
    costUsd: latest.costUsd ?? 0,
    runId: latest.executionId ?? null,
    createdByRunId: latest.executionId ?? latest.id,
    recordedAt: latest.startedAt,
  });
});

/** GET /api/agents/:id/runs — list runs (heartbeats) for an agent */
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

  const heartbeats = controlPlaneStore
    .listHeartbeats(userId, agent.teamId)
    .filter((hb) => hb.agentId === agent.id);

  const runs = heartbeats.map((hb) => ({
    id: hb.id,
    agentId: hb.agentId,
    userId: hb.userId,
    runId: hb.executionId ?? null,
    status: hb.completedAt ? "completed" : hb.status === "running" ? "running" : "completed",
    summary: hb.summary ?? null,
    tokenUsage: 0,
    costUsd: hb.costUsd ?? 0,
    startedAt: hb.startedAt,
    completedAt: hb.completedAt ?? hb.startedAt,
    createdByRunId: hb.executionId ?? hb.id,
    createdAt: hb.startedAt,
  }));

  res.json({ runs });
});

/** GET /api/agents/:id/budget — budget snapshot for an agent */
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

  const heartbeats = controlPlaneStore
    .listHeartbeats(userId, agent.teamId)
    .filter((hb) => hb.agentId === agent.id);

  const now = new Date();
  const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const spentUsd = heartbeats
    .filter((hb) => new Date(hb.startedAt) >= currentPeriodStart)
    .reduce((sum, hb) => sum + (hb.costUsd ?? 0), 0);

  res.json({
    agentId: agent.id,
    userId: agent.userId,
    monthlyUsd: agent.budgetMonthlyUsd,
    spentUsd,
    remainingUsd: Math.max(0, agent.budgetMonthlyUsd - spentUsd),
    currentPeriod: currentPeriodStart.toISOString().slice(0, 7),
    autoPaused: agent.status === "paused" && spentUsd >= agent.budgetMonthlyUsd,
    lastUpdatedAt: agent.updatedAt,
  });
});

/** GET /api/agents/:id/token-usage — token usage report for an agent */
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

  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string, 10) || 30));
  const cutoff = new Date(Date.now() - days * 86400000);

  const heartbeats = controlPlaneStore
    .listHeartbeats(userId, agent.teamId)
    .filter((hb) => hb.agentId === agent.id && new Date(hb.startedAt) >= cutoff);

  const dailyMap = new Map<string, { tokens: number; costUsd: number }>();
  for (const hb of heartbeats) {
    const date = hb.startedAt.slice(0, 10);
    const entry = dailyMap.get(date) ?? { tokens: 0, costUsd: 0 };
    entry.costUsd += hb.costUsd ?? 0;
    dailyMap.set(date, entry);
  }

  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, tokens: data.tokens, costUsd: data.costUsd }));

  res.json({
    agentId: agent.id,
    userId: agent.userId,
    days,
    totalTokens: 0,
    totalCostUsd: daily.reduce((sum, d) => sum + d.costUsd, 0),
    daily,
  });
});

export default router;
