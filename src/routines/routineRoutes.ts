import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { ControlPlaneAgent } from "../controlPlane/types";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const router = express.Router();

type DashboardRoutineStatus = "active" | "paused";

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function resolveRequestContext(req: WorkspaceAwareRequest, res: express.Response) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }

  return {
    userId,
    workspaceId: req.workspaceId?.trim() || undefined,
  };
}

function toRoutineStatus(status: ControlPlaneAgent["status"]): DashboardRoutineStatus {
  return status === "active" ? "active" : "paused";
}

function latestTimestamp(...timestamps: Array<string | undefined>): string | undefined {
  return timestamps
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
}

function getLastRunAt(agent: ControlPlaneAgent, userId: string, workspaceId?: string): string | undefined {
  const lastExecution = controlPlaneStore.listAgentExecutions(agent.id, userId, workspaceId).at(-1);
  const lastHeartbeat = controlPlaneStore.listAgentHeartbeats(agent.id, userId, workspaceId).at(-1);

  return latestTimestamp(
    lastExecution?.completedAt ?? lastExecution?.startedAt ?? lastExecution?.requestedAt,
    lastHeartbeat?.completedAt ?? lastHeartbeat?.startedAt
  );
}

function getNextRunAt(agent: ControlPlaneAgent, lastRunAt?: string): string | undefined {
  if (agent.status !== "active") {
    return undefined;
  }
  if (agent.schedule.type !== "interval" || !agent.schedule.intervalMinutes) {
    return undefined;
  }

  const anchor = lastRunAt ?? agent.lastHeartbeatAt ?? agent.updatedAt ?? agent.createdAt;
  const anchorMs = Date.parse(anchor);
  if (Number.isNaN(anchorMs)) {
    return undefined;
  }

  return new Date(anchorMs + agent.schedule.intervalMinutes * 60_000).toISOString();
}

router.get("/", (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req, res);
  if (!context) {
    return;
  }

  const teams = new Map(
    controlPlaneStore.listTeams(context.userId, context.workspaceId).map((team) => [team.id, team])
  );

  const routines = controlPlaneStore
    .listAllAgents(context.userId, context.workspaceId)
    .filter((agent) => agent.schedule.type !== "manual")
    .map((agent) => {
      const lastRunAt = getLastRunAt(agent, context.userId, context.workspaceId);
      const nextRunAt = getNextRunAt(agent, lastRunAt);
      const team = teams.get(agent.teamId);

      return {
        id: `routine-${agent.id}`,
        userId: agent.userId,
        agentId: agent.id,
        name: agent.name,
        description: team?.description ?? null,
        scheduleType: agent.schedule.type,
        cronExpression: agent.schedule.cronExpression ?? null,
        intervalMinutes: agent.schedule.intervalMinutes ?? null,
        prompt: null,
        status: toRoutineStatus(agent.status),
        metadata: {
          teamId: agent.teamId,
          teamName: team?.name ?? null,
          workflowStepId: agent.workflowStepId ?? null,
          workflowStepKind: agent.workflowStepKind ?? null,
          source: "control-plane-agent-schedule",
        },
        lastRunAt: lastRunAt ?? null,
        nextRunAt: nextRunAt ?? null,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      };
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  res.json({ routines, total: routines.length });
});

export default router;
