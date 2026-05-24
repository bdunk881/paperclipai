import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import {
  getPostgresPool,
  isPostgresPersistenceEnabled,
} from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";

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

router.get("/", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  // DASH-64.6: listTeams is async now (repo-backed).
  const teamRows = await controlPlaneStore.listTeams(context.userId, context.workspaceId);
  const teams = new Map(teamRows.map((team) => [team.id, team]));

  // DASH-64.4: listAgentExecutions is async now — Promise.all the
  // per-agent enrichment instead of mapping synchronously.
  // DASH-64.5: listAllAgents is async now (repo-backed).
  const allAgents = await controlPlaneStore.listAllAgents(context.userId, context.workspaceId);
  const inMemoryAgents = await Promise.all(
    allAgents
      .map(async (agent) => {
        const team = teams.get(agent.teamId);
        const executions = await controlPlaneStore.listAgentExecutions(
          agent.id,
          context.userId,
          context.workspaceId,
        );
        const lastExecution = executions.at(-1);
        return {
          id: agent.id,
          userId: agent.userId,
          name: agent.name,
          // HEL-210: in-memory legacy store doesn't carry display_name;
          // expose null so the dashboard falls back to `name`. The
          // Postgres-backed branch (loadCanonicalAgents) returns the
          // real column value.
          displayName: null as string | null,
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
      }),
  );

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
}));

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
    /** HEL-210: nullable owner-defined alias; UI falls back to `name`. */
    displayName: string | null;
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
    // HEL-210: nullable owner-defined alias surfaced as the primary
    // line on org/agent views. Falls back to `name` when null.
    display_name: string | null;
    role_key: string;
    model: string | null;
    instructions: string | null;
    budget_monthly_usd: string | number;
    reporting_to_agent_id: string | null;
    metadata: Record<string, unknown> | null;
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
                a.display_name,
                a.role_key, a.model, a.instructions, a.budget_monthly_usd,
                a.reporting_to_agent_id, a.metadata, a.status, a.last_heartbeat_at,
                a.created_at, a.updated_at,
                t.name AS team_name, t.description AS team_description
           FROM agents a
           LEFT JOIN agent_teams t ON t.id = a.team_id
          WHERE a.workspace_id = $1
          ORDER BY a.created_at ASC`,
        [workspaceId],
      );
      return result.rows.map((row) => {
        const stored =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {};
        return {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          displayName: row.display_name,
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
            ...stored,
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
        };
      });
    },
  );
}

/**
 * GET /api/agents/heartbeats — latest heartbeat per agent (workspace-scoped).
 * Must be registered before /:id/heartbeat so "heartbeats" is not parsed as an id.
 */
router.get("/heartbeats", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context?.workspaceId) {
    res.status(401).json({ error: "Authenticated user + workspace required" });
    return;
  }

  const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  if (!isPostgresPersistenceEnabled()) {
    const allAgents = await controlPlaneStore.listAllAgents(context.userId, context.workspaceId);
    const agentIds = allAgents.slice(0, limit).map((a) => a.id);
    const heartbeats: Record<string, unknown> = {};
    await Promise.all(
      agentIds.map(async (agentId) => {
        const rows = await controlPlaneStore.listAgentHeartbeats(
          agentId,
          context.userId,
          context.workspaceId,
        );
        const heartbeat = rows.at(-1);
        if (!heartbeat) {
          heartbeats[agentId] = null;
          return;
        }
        heartbeats[agentId] = {
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
        };
      }),
    );
    res.json({ heartbeats, total: Object.keys(heartbeats).length });
    return;
  }

  try {
    const pool = getPostgresPool();
    const result = await withWorkspaceContext(
      pool,
      { workspaceId: context.workspaceId, userId: context.userId },
      async (client) =>
        client.query<{
          id: string;
          agent_id: string;
          user_id: string;
          status: "queued" | "running" | "completed" | "blocked";
          summary: string | null;
          cost_usd: string | number;
          execution_id: string | null;
          started_at: Date | string;
          completed_at: Date | string | null;
        }>(
          `SELECT DISTINCT ON (h.agent_id)
                  h.id, h.agent_id, h.user_id, h.status, h.summary,
                  h.cost_usd, h.execution_id, h.started_at, h.completed_at
             FROM agent_heartbeats h
            WHERE h.workspace_id = $1
            ORDER BY h.agent_id, h.started_at DESC
            LIMIT $2`,
          [context.workspaceId, limit],
        ),
    );

    const heartbeats: Record<string, unknown> = {};
    for (const row of result.rows) {
      heartbeats[row.agent_id] = {
        id: row.id,
        agentId: row.agent_id,
        userId: row.user_id,
        status: toDashboardHeartbeatStatus(row.status),
        summary: row.summary,
        tokenUsage: 0,
        costUsd: Number(row.cost_usd ?? 0),
        runId: row.execution_id,
        createdByRunId: row.execution_id ?? "control-plane",
        recordedAt:
          row.completed_at instanceof Date
            ? row.completed_at.toISOString()
            : row.completed_at
              ? String(row.completed_at)
              : row.started_at instanceof Date
                ? row.started_at.toISOString()
                : String(row.started_at),
      };
    }
    res.json({ heartbeats, total: Object.keys(heartbeats).length });
  } catch (err) {
    console.error(`[agentRoutes] /heartbeats failed: ${(err as Error).message}`);
    res.status(500).json({ error: "Failed to load agent heartbeats" });
  }
}));

router.get("/:id/heartbeat", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  // DASH-64.5: getAgent is async now (repo-backed).
  const agent = await controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  // DASH-64.2 iter 2 (Codex P1 on #902): wrap the async repository
  // read in try/catch — Express 4 doesn't auto-convert async
  // rejections into 500 responses, so a transient DB/RLS/query
  // failure would otherwise bubble out as an unhandled exception.
  try {
    const agentHeartbeats = await controlPlaneStore.listAgentHeartbeats(
      agent.id,
      context.userId,
      context.workspaceId,
    );
    const heartbeat = agentHeartbeats.at(-1);
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
  } catch (err) {
    console.error(
      `[agentRoutes] /:id/heartbeat repository error for agent=${agent.id}: ${
        (err as Error).message
      }`,
    );
    res.status(500).json({ error: "Failed to load agent heartbeat" });
  }
}));

router.get("/:id/runs", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  // DASH-64.5: getAgent is async now (repo-backed).
  const agent = await controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    // DASH-64.4: listAgentExecutions is now async (repository-backed).
    const executions = await controlPlaneStore.listAgentExecutions(
      agent.id,
      context.userId,
      context.workspaceId,
    );
    const runs = executions.map((execution) => ({
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
  } catch (err) {
    console.warn(`[agentRoutes] /:id/runs failed: ${(err as Error).message}`);
    res.status(500).json({ error: "agent_runs_unavailable" });
  }
}));

router.get("/:id/budget", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  // DASH-64.5: getAgent is async now (repo-backed).
  const agent = await controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  // DASH-64.2 iter 2 (Codex P1 on #902): wrap async repo I/O in
  // try/catch — Express 4 doesn't translate async rejections to 500s.
  try {
    const period = currentPeriodKey();
    // DASH-64.3: getTeamSpendSnapshot is now async.
    const teamSpend = await controlPlaneStore.getTeamSpendSnapshot(
      agent.teamId,
      context.userId,
      context.workspaceId,
    );
    const agentSpend = teamSpend?.agents.find((entry) => entry.agentId === agent.id);
    const heartbeats = await controlPlaneStore.listAgentHeartbeats(agent.id, context.userId, context.workspaceId);
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
  } catch (err) {
    console.error(
      `[agentRoutes] /:id/budget repository error for agent=${agent.id}: ${
        (err as Error).message
      }`,
    );
    res.status(500).json({ error: "Failed to load agent budget" });
  }
}));

router.get("/:id/token-usage", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  // DASH-64.5: getAgent is async now (repo-backed).
  const agent = await controlPlaneStore.getAgent(req.params.id, context.userId, context.workspaceId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const parsedDays = Number.parseInt(String(req.query.days ?? "30"), 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

  // DASH-64.2 iter 2 (Codex P1 on #902): wrap async repo I/O in
  // try/catch.
  let agentHeartbeats: Awaited<ReturnType<typeof controlPlaneStore.listAgentHeartbeats>>;
  try {
    agentHeartbeats = await controlPlaneStore.listAgentHeartbeats(
      agent.id,
      context.userId,
      context.workspaceId,
    );
  } catch (err) {
    console.error(
      `[agentRoutes] /:id/token-usage repository error for agent=${agent.id}: ${
        (err as Error).message
      }`,
    );
    res.status(500).json({ error: "Failed to load agent token usage" });
    return;
  }

  const dailyCosts = new Map<string, number>();
  for (const heartbeat of agentHeartbeats) {
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
}));

// ---------------------------------------------------------------------------
// PATCH /api/agents/:id (HEL-190 — edit agent)
//
// Accepts partial `{ name?, status?, budgetMonthlyUsd?, instructions? }`.
// `status` accepts the canonical DB enum ("active" | "paused" |
// "terminated"); the dashboard maps to its presentation vocabulary
// (idle/running/paused/error) at render time. Use DELETE to soft-terminate.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(["active", "paused", "terminated"]);
const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 8000;
const MAX_BUDGET_USD = 100_000;

router.patch("/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context || !context.workspaceId) {
    res.status(401).json({ error: "Authenticated user + workspace required" });
    return;
  }
  if (!UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: "Invalid agent ID format" });
    return;
  }
  if (!isPostgresPersistenceEnabled()) {
    res.status(503).json({ error: "Agent updates require PostgreSQL persistence" });
    return;
  }

  const body = req.body as {
    name?: unknown;
    status?: unknown;
    budgetMonthlyUsd?: unknown;
    instructions?: unknown;
  };

  const sets: string[] = [];
  const args: unknown[] = [];

  if (body?.name !== undefined) {
    if (typeof body.name !== "string") {
      res.status(400).json({ error: "name must be a string" });
      return;
    }
    const trimmed = body.name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `name too long (max ${MAX_NAME_LENGTH})` });
      return;
    }
    args.push(trimmed);
    sets.push(`name = $${args.length}`);
  }

  if (body?.status !== undefined) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      res.status(400).json({
        error: "status must be one of: active, paused, terminated",
      });
      return;
    }
    args.push(body.status);
    sets.push(`status = $${args.length}`);
  }

  if (body?.budgetMonthlyUsd !== undefined) {
    const budget = Number(body.budgetMonthlyUsd);
    if (!Number.isFinite(budget) || budget < 0 || budget > MAX_BUDGET_USD) {
      res.status(400).json({
        error: `budgetMonthlyUsd must be a number between 0 and ${MAX_BUDGET_USD}`,
      });
      return;
    }
    args.push(budget);
    sets.push(`budget_monthly_usd = $${args.length}`);
  }

  if (body?.instructions !== undefined) {
    if (typeof body.instructions !== "string") {
      res.status(400).json({ error: "instructions must be a string" });
      return;
    }
    if (body.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      res.status(400).json({
        error: `instructions too long (max ${MAX_INSTRUCTIONS_LENGTH})`,
      });
      return;
    }
    args.push(body.instructions);
    sets.push(`instructions = $${args.length}`);
  }

  if (sets.length === 0) {
    res.status(400).json({
      error: "At least one of `name`, `status`, `budgetMonthlyUsd`, or `instructions` must be provided",
    });
    return;
  }

  // Always bump updated_at for free.
  sets.push(`updated_at = NOW()`);
  args.push(req.params.id);
  args.push(context.workspaceId);

  try {
    const pool = getPostgresPool();
    const result = await withWorkspaceContext(
      pool,
      { workspaceId: context.workspaceId, userId: context.userId },
      (client) =>
        client.query<{ id: string }>(
          `UPDATE agents
              SET ${sets.join(", ")}
            WHERE id = $${args.length - 1}
              AND workspace_id = $${args.length}
          RETURNING id`,
          args,
        ),
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const refreshed = await loadCanonicalAgents(
      context.workspaceId,
      context.userId,
    );
    const updated = refreshed.find((agent) => agent.id === req.params.id);
    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error(
      `[agentRoutes] PATCH /:id failed for agent=${req.params.id}: ${
        (err as Error).message
      }`,
    );
    res.status(500).json({ error: "Failed to update agent" });
  }
}));

// ---------------------------------------------------------------------------
// DELETE /api/agents/:id (HEL-190 — soft-terminate)
//
// Soft-delete: sets status='terminated' so historical runs, org_edges,
// and audit references stay intact. The dashboard hides terminated
// agents from the default Team view but they remain queryable for audit.
// Already-terminated agents return 200 (idempotent) so the dashboard's
// "are you sure?" flow doesn't 404 on retry.
// ---------------------------------------------------------------------------
router.delete("/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const context = resolveRequestContext(req);
  if (!context || !context.workspaceId) {
    res.status(401).json({ error: "Authenticated user + workspace required" });
    return;
  }
  if (!UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: "Invalid agent ID format" });
    return;
  }
  if (!isPostgresPersistenceEnabled()) {
    res.status(503).json({ error: "Agent termination requires PostgreSQL persistence" });
    return;
  }

  try {
    const pool = getPostgresPool();
    const result = await withWorkspaceContext(
      pool,
      { workspaceId: context.workspaceId, userId: context.userId },
      (client) =>
        client.query<{ id: string }>(
          `UPDATE agents
              SET status = 'terminated', updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2
          RETURNING id`,
          [req.params.id, context.workspaceId],
        ),
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.status(204).end();
  } catch (err) {
    console.error(
      `[agentRoutes] DELETE /:id failed for agent=${req.params.id}: ${
        (err as Error).message
      }`,
    );
    res.status(500).json({ error: "Failed to terminate agent" });
  }
}));

export default router;
