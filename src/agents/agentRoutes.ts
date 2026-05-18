import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import {
  getPostgresPool,
  isPostgresPersistenceEnabled,
} from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const router = express.Router();

type DashboardAgentStatus = "running" | "paused" | "idle" | "error";
type DashboardRunStatus = "queued" | "running" | "completed" | "failed" | "blocked";

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function resolveRequestContext(req: WorkspaceAwareRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return null;
  }
  return {
    userId,
    workspaceId: req.workspaceId?.trim() || undefined,
  };
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

router.get("/", async (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const teams = new Map(
    controlPlaneStore
      .listTeams(context.userId, context.workspaceId)
      .map((team) => [team.id, team]),
  );

  const inMemoryAgents = controlPlaneStore
    .listAllAgents(context.userId, context.workspaceId)
    .map((agent) => {
      const team = teams.get(agent.teamId);
      const executions = controlPlaneStore.listAgentExecutions(
        agent.id,
        context.userId,
        context.workspaceId,
      );
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

  // DASH-27: hiring-plan confirm writes agents directly to Postgres
  // via withWorkspaceContext + raw INSERT — they never land in the
  // legacy in-memory controlPlaneStore. Read both stores and merge
  // by agent.id so newly-provisioned agents show up on the Team
  // page without a server restart. The in-memory store stays as
  // the source for runtime-only fields (lastHeartbeatStatus,
  // executions) that the canonical Postgres rows don't carry yet.
  const inMemoryById = new Map(inMemoryAgents.map((a) => [a.id, a]));
  const merged = [...inMemoryAgents];
  if (
    isPostgresPersistenceEnabled() &&
    context.workspaceId &&
    typeof context.workspaceId === "string"
  ) {
    try {
      const pgAgents = await loadCanonicalAgents(
        context.workspaceId,
        context.userId,
      );
      for (const agent of pgAgents) {
        if (!inMemoryById.has(agent.id)) merged.push(agent);
      }
    } catch (err) {
      console.warn(
        `[agentRoutes] canonical Postgres read failed (continuing with in-memory only): ${
          (err as Error).message
        }`,
      );
    }
  }

  res.json({ agents: merged, total: merged.length });
});

/**
 * Loads agents directly from the canonical `agents` Postgres table for
 * the active workspace. Shape matches the in-memory dashboard payload
 * above so the route can append without per-source transforms in the
 * UI. Joined to `agent_teams` for the teamName field.
 */
async function loadCanonicalAgents(
  workspaceId: string,
  userId: string,
): Promise<
  Array<{
    id: string;
    userId: string;
    name: string;
    description: string | null;
    roleKey: string;
    model: string | null;
    instructions: string;
    status: DashboardAgentStatus;
    budgetMonthlyUsd: number;
    metadata: {
      teamId: string;
      teamName: string | null;
      reportingToAgentId: string | null;
      workflowStepId: string | null;
      workflowStepKind: string | null;
    };
    lastHeartbeatAt: string | null;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>
> {
  interface AgentRow {
    id: string;
    workspace_id: string;
    user_id: string;
    team_id: string;
    name: string;
    role_key: string;
    model: string | null;
    instructions: string | null;
    budget_monthly_usd: string | number;
    reporting_to_agent_id: string | null;
    status: "active" | "paused" | "terminated";
    last_heartbeat_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
    team_name: string | null;
    team_description: string | null;
  }

  const pool = getPostgresPool();
  return withWorkspaceContext(
    pool,
    { workspaceId, userId },
    async (client) => {
      const result = await client.query<AgentRow>(
        `SELECT a.id, a.workspace_id, a.user_id, a.team_id, a.name,
                a.role_key, a.model, a.instructions, a.budget_monthly_usd,
                a.reporting_to_agent_id, a.status, a.last_heartbeat_at,
                a.created_at, a.updated_at,
                t.name AS team_name, t.description AS team_description
           FROM agents a
           LEFT JOIN agent_teams t ON t.id = a.team_id
          WHERE a.workspace_id = $1
          ORDER BY a.created_at ASC`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        description: row.team_description,
        roleKey: row.role_key,
        model: row.model,
        instructions: row.instructions ?? "",
        status: toDashboardAgentStatus(row.status),
        budgetMonthlyUsd: Number(row.budget_monthly_usd),
        metadata: {
          teamId: row.team_id,
          teamName: row.team_name,
          reportingToAgentId: row.reporting_to_agent_id,
          workflowStepId: null,
          workflowStepKind: null,
        },
        lastHeartbeatAt:
          row.last_heartbeat_at instanceof Date
            ? row.last_heartbeat_at.toISOString()
            : (row.last_heartbeat_at ?? null),
        lastRunAt: null,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        updatedAt:
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : String(row.updated_at),
      }));
    },
  );
}

router.get("/:id/heartbeat", (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const heartbeat = controlPlaneStore.listAgentHeartbeats(agent.id, context.userId, context.workspaceId).at(-1);
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

router.get("/:id/runs", (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const runs = controlPlaneStore.listAgentExecutions(agent.id, context.userId, context.workspaceId).map((execution) => ({
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

router.get("/:id/budget", (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const period = currentPeriodKey();
  const teamSpend = controlPlaneStore.getTeamSpendSnapshot(agent.teamId, context.userId, context.workspaceId);
  const agentSpend = teamSpend?.agents.find((entry) => entry.agentId === agent.id);
  const heartbeats = controlPlaneStore.listAgentHeartbeats(agent.id, context.userId, context.workspaceId);
  const spentUsd = agentSpend?.spentUsd ?? 0;
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
    thresholdState: agentSpend?.thresholdState ?? "healthy",
    alertThresholdsTriggered: agentSpend?.alertThresholdsTriggered ?? [],
    lastUpdatedAt,
  });
});

router.get("/:id/token-usage", (req: WorkspaceAwareRequest, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const agent = controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
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
  for (const heartbeat of controlPlaneStore.listAgentHeartbeats(agent.id, context.userId, context.workspaceId)) {
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
