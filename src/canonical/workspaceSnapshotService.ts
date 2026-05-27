/**
 * Workspace snapshot builder for GET /api/workspace/snapshot.
 *
 * Aggregates the Home page's fan-out (agents, missions, approvals, runs,
 * budgets, heartbeats) into one RLS-scoped response. Optional Redis cache
 * wraps the builder in the route layer.
 */

import type { Pool } from "pg";
import { approvalStore } from "../engine/approvalStore";
import { runStore } from "../engine/runStore";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { entitlementStore } from "../billing/entitlements";
import { cachedWorkspaceRead } from "../cache/readCache";

const HOME_RUN_LIMIT = 100;
const HOME_HEARTBEAT_LIMIT = 50;

export interface SnapshotAgent {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  roleKey?: string | null;
  model?: string | null;
  instructions: string;
  status: "running" | "paused" | "idle" | "error";
  budgetMonthlyUsd: number;
  metadata: Record<string, unknown>;
  lastHeartbeatAt?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotHeartbeat {
  id: string;
  agentId: string;
  userId: string;
  status: "running" | "paused" | "idle" | "error";
  summary?: string | null;
  tokenUsage: number;
  costUsd: number;
  runId?: string | null;
  createdByRunId: string;
  recordedAt: string;
}

export interface SnapshotMission {
  id: string;
  statement: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  companyId: string;
  companyName: string;
  latestHiringPlanId: string | null;
}

export interface SnapshotApproval {
  id: string;
  runId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  assignee: string;
  message: string;
  timeoutMinutes: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "timed_out";
  resolvedAt?: string;
  comment?: string;
  agentId?: string;
}

export interface SnapshotBudget {
  id: string;
  scopeKind: "workspace" | "agent";
  scopeId: string | null;
  capCents: number;
  usedCents: number;
  period: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRun {
  id: string;
  templateId: string;
  templateName: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HomeWorkspaceSnapshot {
  agents: SnapshotAgent[];
  missions: SnapshotMission[];
  approvals: SnapshotApproval[];
  runs: SnapshotRun[];
  budgets: SnapshotBudget[];
  heartbeats: Record<string, SnapshotHeartbeat | null>;
  generatedAt: string;
}

function toDashboardAgentStatus(
  status: "active" | "paused" | "terminated",
  lastHeartbeatStatus?: "queued" | "running" | "completed" | "blocked",
): SnapshotAgent["status"] {
  if (status === "paused") return "paused";
  if (status === "terminated") return "idle";
  if (lastHeartbeatStatus === "blocked") return "error";
  if (lastHeartbeatStatus === "running") return "running";
  return "idle";
}

function toDashboardHeartbeatStatus(
  status: "queued" | "running" | "completed" | "blocked",
): SnapshotHeartbeat["status"] {
  if (status === "running") return "running";
  if (status === "blocked") return "error";
  return "idle";
}

async function loadAgentsPostgres(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<SnapshotAgent[]> {
  interface AgentRow {
    id: string;
    user_id: string;
    team_id: string;
    name: string;
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

  const rows = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
    const result = await client.query<AgentRow>(
      `SELECT a.id, a.user_id, a.team_id, a.name,
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
    return result.rows;
  });

  return rows.map((row) => {
    const stored =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    return {
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
        ...stored,
      },
      lastHeartbeatAt:
        row.last_heartbeat_at instanceof Date
          ? row.last_heartbeat_at.toISOString()
          : (row.last_heartbeat_at ?? null),
      lastRunAt: null,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  });
}

async function loadAgentsInMemory(
  userId: string,
  workspaceId: string,
): Promise<SnapshotAgent[]> {
  const teamRows = await controlPlaneStore.listTeams(userId, workspaceId);
  const teams = new Map(teamRows.map((team) => [team.id, team]));
  const allAgents = await controlPlaneStore.listAllAgents(userId, workspaceId);

  return allAgents.map((agent) => {
    const team = teams.get(agent.teamId);
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
      },
      lastHeartbeatAt: agent.lastHeartbeatAt ?? null,
      lastRunAt: null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  });
}

async function loadMissionsPostgres(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<SnapshotMission[]> {
  interface ListRow {
    id: string;
    statement: string;
    status: string;
    metadata: Record<string, unknown> | null;
    created_at: Date | string;
    company_id: string;
    company_name: string;
    latest_hiring_plan_id: string | null;
  }

  const result = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) =>
    client.query<ListRow>(
      `SELECT m.id, m.statement, m.status, m.metadata, m.created_at,
              m.company_id, c.name AS company_name,
              (
                SELECT hp.id FROM hiring_plans hp
                 WHERE hp.mission_id = m.id
                 ORDER BY hp.created_at DESC
                 LIMIT 1
              ) AS latest_hiring_plan_id
         FROM missions m
         JOIN companies c ON c.id = m.company_id
        WHERE c.workspace_id = $1
        ORDER BY m.created_at DESC
        LIMIT 100`,
      [workspaceId],
    ),
  );

  return result.rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    companyId: row.company_id,
    companyName: row.company_name,
    latestHiringPlanId: row.latest_hiring_plan_id,
  }));
}

async function loadBudgetsPostgres(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<SnapshotBudget[]> {
  const result = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) =>
    client.query<{
      id: string;
      scope_kind: "workspace" | "agent";
      scope_id: string | null;
      cap_cents: number | string;
      used_cents: number | string;
      period: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, scope_kind, scope_id, cap_cents, used_cents,
              period, created_at, updated_at
         FROM budgets
        WHERE workspace_id = $1
        ORDER BY scope_kind ASC, created_at ASC
        LIMIT 500`,
      [workspaceId],
    ),
  );

  return result.rows.map((row) => ({
    id: row.id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    capCents: Number(row.cap_cents),
    usedCents: Number(row.used_cents),
    period: row.period,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

async function loadHeartbeatsPostgres(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<Record<string, SnapshotHeartbeat | null>> {
  interface HeartbeatRow {
    id: string;
    agent_id: string;
    user_id: string;
    status: "queued" | "running" | "completed" | "blocked";
    summary: string | null;
    cost_usd: string | number;
    execution_id: string | null;
    started_at: Date | string;
    completed_at: Date | string | null;
  }

  const result = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) =>
    client.query<HeartbeatRow>(
      `SELECT DISTINCT ON (h.agent_id)
              h.id, h.agent_id, h.user_id, h.status, h.summary,
              h.cost_usd, h.execution_id, h.started_at, h.completed_at
         FROM agent_heartbeats h
        WHERE h.workspace_id = $1
        ORDER BY h.agent_id, h.started_at DESC
        LIMIT $2`,
      [workspaceId, HOME_HEARTBEAT_LIMIT],
    ),
  );

  const map: Record<string, SnapshotHeartbeat | null> = {};
  for (const row of result.rows) {
    map[row.agent_id] = {
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
  return map;
}

async function loadHeartbeatsInMemory(
  userId: string,
  workspaceId: string,
  agentIds: string[],
): Promise<Record<string, SnapshotHeartbeat | null>> {
  const map: Record<string, SnapshotHeartbeat | null> = {};
  const limited = agentIds.slice(0, HOME_HEARTBEAT_LIMIT);
  await Promise.all(
    limited.map(async (agentId) => {
      const heartbeats = await controlPlaneStore.listAgentHeartbeats(
        agentId,
        userId,
        workspaceId,
      );
      const heartbeat = heartbeats.at(-1);
      if (!heartbeat) {
        map[agentId] = null;
        return;
      }
      map[agentId] = {
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
  return map;
}

async function loadApprovals(userId: string): Promise<SnapshotApproval[]> {
  const approvals = (await approvalStore.list()).filter(
    (approval) => approval.assignee === userId,
  );
  return approvals.map((approval) => ({
    id: approval.id,
    runId: approval.runId,
    templateName: approval.templateName,
    stepId: approval.stepId,
    stepName: approval.stepName,
    assignee: approval.assignee,
    message: approval.message,
    timeoutMinutes: approval.timeoutMinutes,
    requestedAt: approval.requestedAt,
    status:
      approval.status === "request_changes"
        ? "rejected"
        : (approval.status as SnapshotApproval["status"]),
    resolvedAt: approval.resolvedAt,
    comment: approval.comment,
    agentId: approval.agentId,
  }));
}

async function loadRuns(workspaceId: string): Promise<SnapshotRun[]> {
  const runs = await runStore.listForSnapshot(workspaceId, HOME_RUN_LIMIT);
  return runs as unknown as SnapshotRun[];
}

export async function buildHomeSnapshot(
  workspaceId: string,
  userId: string,
): Promise<HomeWorkspaceSnapshot> {
  const usePostgres = isPostgresPersistenceEnabled();
  const pool = usePostgres ? getPostgresPool() : null;

  let agents: SnapshotAgent[];
  let missions: SnapshotMission[];
  let budgets: SnapshotBudget[];

  if (pool) {
    const [pgAgents, inMemoryAgents, pgMissions, pgBudgets] = await Promise.all([
      loadAgentsPostgres(pool, workspaceId, userId),
      loadAgentsInMemory(userId, workspaceId),
      loadMissionsPostgres(pool, workspaceId, userId).catch(() => [] as SnapshotMission[]),
      loadBudgetsPostgres(pool, workspaceId, userId).catch(() => [] as SnapshotBudget[]),
    ]);
    const byId = new Map(pgAgents.map((a) => [a.id, a]));
    for (const agent of inMemoryAgents) {
      if (!byId.has(agent.id)) {
        byId.set(agent.id, agent);
      }
    }
    agents = Array.from(byId.values());
    missions = pgMissions;
    budgets = pgBudgets;
  } else {
    agents = await loadAgentsInMemory(userId, workspaceId);
    missions = [];
    budgets = [];
  }

  const [approvals, runs, heartbeats] = await Promise.all([
    loadApprovals(userId),
    loadRuns(workspaceId),
    pool
      ? loadHeartbeatsPostgres(pool, workspaceId, userId)
      : loadHeartbeatsInMemory(
          userId,
          workspaceId,
          agents.map((a) => a.id),
        ),
  ]);

  void entitlementStore.get(workspaceId);

  return {
    agents,
    missions,
    approvals,
    runs,
    budgets,
    heartbeats,
    generatedAt: new Date().toISOString(),
  };
}

export async function getCachedHomeSnapshot(
  workspaceId: string,
  userId: string,
): Promise<HomeWorkspaceSnapshot> {
  return cachedWorkspaceRead(workspaceId, "home", 20, () =>
    buildHomeSnapshot(workspaceId, userId),
  );
}
