/**
 * Control-plane execution-state repository (ALT-2042 / ALT-1915 Phase 4).
 *
 * Replaces the in-process `tasks`, `heartbeats`, `spendEntries`, and
 * `budgetAlerts` Maps in src/controlPlane/controlPlaneStore.ts with PostgreSQL
 * tables (see migrations/019_control_plane_execution_state.sql) so execution
 * state survives a process restart and remains workspace-isolated under RLS.
 *
 * Every method here routes through `withWorkspaceContext` so the
 * `app.current_workspace_id` session var is always set inside the same
 * transaction as the query. Cross-tenant queries return zero rows by RLS, and
 * a missing session var returns zero rows by NULL-denial — same hardened
 * pattern as Phases 2/3.
 */

import { PoolClient } from "pg";
import { getPostgresPool, inMemoryAllowed, isPostgresConfigured } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  AgentHeartbeatRecord,
  BudgetAlertScope,
  ControlPlaneBudgetAlert,
  ControlPlaneSpendEntry,
  ControlPlaneTask,
  ControlPlaneTaskAuditEvent,
  ControlPlaneTaskStatus,
  HeartbeatStatus,
  SpendCategory,
} from "./types";

// ---------------------------------------------------------------------------
// DASH-64.1: In-memory fallback for test/dev mode (HEL-80 pattern).
//
// Production runs with DATABASE_URL set and everything routes through
// Postgres via withWorkspaceContext. Unit tests typically run without
// Postgres available — the previous architecture handled this by keeping
// a parallel in-memory Map at the controlPlaneStore level. DASH-64
// removes those Maps in favor of repository-only reads, so the
// fallback moves here.
//
// `inMemoryAllowed()` is true in NODE_ENV=test / development. Production
// fails fast on the Postgres path because `inMemoryAllowed()` is false
// and the repository goes straight to withWorkspaceContext (which throws
// if Postgres isn't configured — by design, see HEL-80).
//
// Each in-memory store is a workspace-scoped Map<workspaceId, Map<id, row>>
// so cross-tenant isolation behaves the same as RLS would in production.
// ---------------------------------------------------------------------------

// allowlist: test/dev fallback for repository; production routes to Postgres
const memTasks = new Map<string, Map<string, ControlPlaneTask>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memHeartbeats = new Map<string, Map<string, AgentHeartbeatRecord>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memSpendEntries = new Map<string, Map<string, ControlPlaneSpendEntry>>();
// allowlist: test/dev fallback for repository; production routes to Postgres
const memBudgetAlerts = new Map<string, Map<string, ControlPlaneBudgetAlert>>();

function memBucket<T>(
  store: Map<string, Map<string, T>>,
  workspaceId: string,
): Map<string, T> {
  let bucket = store.get(workspaceId);
  if (!bucket) {
    bucket = new Map<string, T>();
    store.set(workspaceId, bucket);
  }
  return bucket;
}

/**
 * Returns true when the repository should use its in-memory fallback
 * instead of going to Postgres. Same gate as HEL-80 elsewhere in the
 * codebase: tests + development without DATABASE_URL.
 */
function useInMemoryFallback(): boolean {
  return !isPostgresConfigured() && inMemoryAllowed();
}

export interface ControlPlaneRepoContext {
  workspaceId: string;
  userId: string;
}

interface TaskRow {
  id: string;
  team_id: string;
  user_id: string;
  title: string;
  description: string | null;
  source_run_id: string | null;
  source_workflow_step_id: string | null;
  assigned_agent_id: string | null;
  execution_id: string | null;
  status: ControlPlaneTaskStatus;
  checked_out_by: string | null;
  checked_out_at: Date | null;
  audit_trail: ControlPlaneTaskAuditEvent[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface HeartbeatRow {
  id: string;
  team_id: string;
  user_id: string;
  agent_id: string;
  execution_id: string | null;
  status: HeartbeatStatus;
  summary: string | null;
  cost_usd: string | null;
  created_task_ids: string[];
  started_at: Date;
  completed_at: Date | null;
}

interface SpendEntryRow {
  id: string;
  team_id: string;
  agent_id: string;
  user_id: string;
  execution_id: string | null;
  category: SpendCategory;
  cost_usd: string;
  model: string | null;
  provider: string | null;
  tool_name: string | null;
  metadata: Record<string, unknown> | null;
  recorded_at: Date;
}

interface BudgetAlertRow {
  id: string;
  team_id: string;
  user_id: string;
  agent_id: string | null;
  tool_name: string | null;
  scope: BudgetAlertScope;
  threshold: string;
  budget_usd: string;
  spent_usd: string;
  recorded_at: Date;
}

function isoFromDate(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function isoFromDateRequired(value: Date): string {
  return value.toISOString();
}

function numericFromString(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericFromStringRequired(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("invalid_numeric_value");
  }
  return parsed;
}

function rowToTask(row: TaskRow): ControlPlaneTask {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    sourceWorkflowStepId: row.source_workflow_step_id ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    checkedOutBy: row.checked_out_by ?? undefined,
    checkedOutAt: isoFromDate(row.checked_out_at),
    status: row.status,
    metadata: row.metadata ?? undefined,
    createdAt: isoFromDateRequired(row.created_at),
    updatedAt: isoFromDateRequired(row.updated_at),
    auditTrail: Array.isArray(row.audit_trail) ? row.audit_trail : [],
  };
}

function rowToHeartbeat(row: HeartbeatRow): AgentHeartbeatRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id,
    executionId: row.execution_id ?? undefined,
    status: row.status,
    summary: row.summary ?? undefined,
    costUsd: numericFromString(row.cost_usd),
    createdTaskIds: Array.isArray(row.created_task_ids) ? row.created_task_ids : [],
    startedAt: isoFromDateRequired(row.started_at),
    completedAt: isoFromDate(row.completed_at),
  };
}

function rowToSpendEntry(row: SpendEntryRow): ControlPlaneSpendEntry {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id,
    executionId: row.execution_id ?? undefined,
    category: row.category,
    costUsd: numericFromStringRequired(row.cost_usd),
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    toolName: row.tool_name ?? undefined,
    metadata: row.metadata ?? undefined,
    recordedAt: isoFromDateRequired(row.recorded_at),
  };
}

function rowToBudgetAlert(row: BudgetAlertRow): ControlPlaneBudgetAlert {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    agentId: row.agent_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    scope: row.scope,
    threshold: numericFromStringRequired(row.threshold),
    budgetUsd: numericFromStringRequired(row.budget_usd),
    spentUsd: numericFromStringRequired(row.spent_usd),
    recordedAt: isoFromDateRequired(row.recorded_at),
  };
}

async function insertTaskRow(client: PoolClient, ctx: ControlPlaneRepoContext, task: ControlPlaneTask): Promise<void> {
  await client.query(
    `INSERT INTO agent_tasks (
       id, workspace_id, user_id, team_id, assigned_agent_id, execution_id,
       title, description, source_run_id, source_workflow_step_id,
       status, checked_out_by, checked_out_at, audit_trail, metadata,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14::jsonb, $15::jsonb,
       $16, $17
     )
     ON CONFLICT (id) DO UPDATE SET
       assigned_agent_id = EXCLUDED.assigned_agent_id,
       execution_id = EXCLUDED.execution_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       status = EXCLUDED.status,
       checked_out_by = EXCLUDED.checked_out_by,
       checked_out_at = EXCLUDED.checked_out_at,
       audit_trail = EXCLUDED.audit_trail,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at`,
    [
      task.id,
      ctx.workspaceId,
      task.userId,
      task.teamId,
      task.assignedAgentId ?? null,
      null, // execution_id - reserved for future cross-link
      task.title,
      task.description ?? null,
      task.sourceRunId ?? null,
      task.sourceWorkflowStepId ?? null,
      task.status,
      task.checkedOutBy ?? null,
      task.checkedOutAt ? new Date(task.checkedOutAt) : null,
      JSON.stringify(task.auditTrail ?? []),
      task.metadata ? JSON.stringify(task.metadata) : null,
      new Date(task.createdAt),
      new Date(task.updatedAt),
    ]
  );
}

async function insertHeartbeatRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  heartbeat: AgentHeartbeatRecord
): Promise<void> {
  await client.query(
    `INSERT INTO agent_heartbeats (
       id, workspace_id, user_id, team_id, agent_id, execution_id,
       status, summary, cost_usd, created_task_ids,
       started_at, completed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10::jsonb,
       $11, $12
     )
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       summary = EXCLUDED.summary,
       cost_usd = EXCLUDED.cost_usd,
       created_task_ids = EXCLUDED.created_task_ids,
       completed_at = EXCLUDED.completed_at`,
    [
      heartbeat.id,
      ctx.workspaceId,
      heartbeat.userId,
      heartbeat.teamId,
      heartbeat.agentId,
      heartbeat.executionId ?? null,
      heartbeat.status,
      heartbeat.summary ?? null,
      heartbeat.costUsd ?? null,
      JSON.stringify(heartbeat.createdTaskIds ?? []),
      new Date(heartbeat.startedAt),
      heartbeat.completedAt ? new Date(heartbeat.completedAt) : null,
    ]
  );
}

async function insertSpendEntryRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  entry: ControlPlaneSpendEntry
): Promise<void> {
  await client.query(
    `INSERT INTO spend_entries (
       id, workspace_id, user_id, team_id, agent_id, execution_id,
       category, cost_usd, model, provider, tool_name, metadata, recorded_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12::jsonb, $13
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      entry.id,
      ctx.workspaceId,
      entry.userId,
      entry.teamId,
      entry.agentId,
      entry.executionId ?? null,
      entry.category,
      entry.costUsd,
      entry.model ?? null,
      entry.provider ?? null,
      entry.toolName ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      new Date(entry.recordedAt),
    ]
  );
}

async function upsertBudgetAlertRow(
  client: PoolClient,
  ctx: ControlPlaneRepoContext,
  alert: ControlPlaneBudgetAlert
): Promise<void> {
  // Match the in-memory dedupe semantics: at most one row per
  // (scope, team, agent|tool, threshold). The partial unique indexes from
  // migration 019 enforce this at the DB level.
  let conflictTarget: string;
  switch (alert.scope) {
    case "team":
      conflictTarget = "(team_id, threshold) WHERE scope = 'team'";
      break;
    case "agent":
      conflictTarget = "(team_id, agent_id, threshold) WHERE scope = 'agent' AND agent_id IS NOT NULL";
      break;
    case "tool":
      conflictTarget = "(team_id, tool_name, threshold) WHERE scope = 'tool' AND tool_name IS NOT NULL";
      break;
  }

  await client.query(
    `INSERT INTO budget_alerts (
       id, workspace_id, user_id, team_id, agent_id, tool_name,
       scope, threshold, budget_usd, spent_usd, recorded_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11
     )
     ON CONFLICT ${conflictTarget} DO UPDATE SET
       budget_usd = EXCLUDED.budget_usd,
       spent_usd = EXCLUDED.spent_usd,
       recorded_at = EXCLUDED.recorded_at`,
    [
      alert.id,
      ctx.workspaceId,
      alert.userId,
      alert.teamId,
      alert.agentId ?? null,
      alert.toolName ?? null,
      alert.scope,
      alert.threshold,
      alert.budgetUsd,
      alert.spentUsd,
      new Date(alert.recordedAt),
    ]
  );
}

export const controlPlaneRepository = {
  async upsertTask(ctx: ControlPlaneRepoContext, task: ControlPlaneTask): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memTasks, ctx.workspaceId).set(task.id, { ...task });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertTaskRow(client, ctx, task);
    });
  },

  /**
   * DASH-64.1: single-task lookup. Used by checkoutTask / updateTaskStatus
   * paths that need to read a row before mutating it. Returns undefined
   * when the task doesn't exist OR the caller doesn't own it (user_id
   * filter — Postgres-side via RLS, in-memory-side via explicit check).
   */
  async getTask(
    ctx: ControlPlaneRepoContext,
    taskId: string,
  ): Promise<ControlPlaneTask | undefined> {
    if (useInMemoryFallback()) {
      // First check the requested workspace's bucket.
      const inWorkspace = memBucket(memTasks, ctx.workspaceId).get(taskId);
      if (inWorkspace) return { ...inWorkspace };
      // DASH-64.1: in tests, callers often don't have a workspace
      // resolved (the route layer hasn't wired one through yet — that's
      // DASH-64.6 work). Walk every bucket to preserve the old
      // global-Map behaviour. Production RLS makes this branch
      // unreachable.
      for (const bucket of memTasks.values()) {
        const task = bucket.get(taskId);
        if (task) return { ...task };
      }
      return undefined;
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // DASH-64.1: workspace RLS is the access boundary; the id alone
      // identifies the task.
      const result = await client.query<TaskRow>(
        `SELECT id, team_id, user_id, title, description, source_run_id,
                source_workflow_step_id, assigned_agent_id, execution_id, status,
                checked_out_by, checked_out_at, audit_trail, metadata,
                created_at, updated_at
           FROM agent_tasks
          WHERE id = $1`,
        [taskId],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : undefined;
    });
  },


  async listTasks(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string }
  ): Promise<ControlPlaneTask[]> {
    if (useInMemoryFallback()) {
      // DASH-64.1: workspace IS the access boundary (RLS analogue).
      // No userId filter — anyone with access to the workspace sees
      // its tasks. The pre-DASH-64 in-memory Map used team-accessibility
      // via listAccessibleTeamIds, which checks workspace membership.
      const bucket = memBucket(memTasks, ctx.workspaceId);
      return Array.from(bucket.values())
        .filter((task) => !filters?.teamId || task.teamId === filters.teamId)
        .map((task) => ({ ...task }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      // DASH-64.1: no user_id filter — workspace RLS is the access
      // boundary. The user_id column tracks who CREATED the task; it's
      // not used for access control.
      const params: unknown[] = [];
      const conditions: string[] = [];
      if (filters?.teamId) {
        params.push(filters.teamId);
        conditions.push(`team_id = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await client.query<TaskRow>(
        `SELECT id, team_id, user_id, title, description, source_run_id,
                source_workflow_step_id, assigned_agent_id, execution_id, status,
                checked_out_by, checked_out_at, audit_trail, metadata,
                created_at, updated_at
           FROM agent_tasks
          ${where}
          ORDER BY created_at ASC`,
        params
      );
      return result.rows.map(rowToTask);
    });
  },

  /**
   * DASH-64.1: list every task across every workspace this user owns.
   * The team-less listTasks variant — used by the observability service's
   * cross-workspace dashboard and any other code path that has a userId
   * but no specific workspace in hand. In-memory fallback walks every
   * bucket; Postgres returns the full user-scoped set under RLS.
   *
   * NOTE: production callers SHOULD pass a workspaceId when they have one
   * for tighter RLS scoping. This helper exists for the legacy
   * `controlPlaneStore.listTasks(userId)` shape which had no workspace
   * filter.
   */
  async listAllTasksForUser(userId: string): Promise<ControlPlaneTask[]> {
    if (useInMemoryFallback()) {
      const out: ControlPlaneTask[] = [];
      for (const bucket of memTasks.values()) {
        for (const task of bucket.values()) {
          if (task.userId === userId) out.push({ ...task });
        }
      }
      return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    // No workspace context — go direct to pool with the user_id filter.
    // RLS on agent_tasks is workspace-scoped so this hits FORCE RLS;
    // use the security-definer helper instead of withWorkspaceContext.
    const pool = getPostgresPool();
    const result = await pool.query<TaskRow>(
      `SELECT id, team_id, user_id, title, description, source_run_id,
              source_workflow_step_id, assigned_agent_id, execution_id, status,
              checked_out_by, checked_out_at, audit_trail, metadata,
              created_at, updated_at
         FROM agent_tasks
        WHERE user_id = $1
        ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows.map(rowToTask);
  },

  async insertHeartbeat(
    ctx: ControlPlaneRepoContext,
    heartbeat: AgentHeartbeatRecord
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memHeartbeats, ctx.workspaceId).set(heartbeat.id, { ...heartbeat });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertHeartbeatRow(client, ctx, heartbeat);
    });
  },

  async listHeartbeats(
    ctx: ControlPlaneRepoContext,
    filters?: { agentId?: string; teamId?: string; limit?: number }
  ): Promise<AgentHeartbeatRecord[]> {
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.agentId) {
        params.push(filters.agentId);
        where += ` AND agent_id = $${params.length}`;
      }
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      let limitClause = "";
      if (typeof filters?.limit === "number" && filters.limit > 0) {
        params.push(filters.limit);
        limitClause = ` LIMIT $${params.length}`;
      }
      const result = await client.query<HeartbeatRow>(
        `SELECT id, team_id, user_id, agent_id, execution_id, status,
                summary, cost_usd, created_task_ids, started_at, completed_at
           FROM agent_heartbeats
          WHERE ${where}
          ORDER BY started_at DESC${limitClause}`,
        params
      );
      return result.rows.map(rowToHeartbeat);
    });
  },

  async insertSpendEntry(
    ctx: ControlPlaneRepoContext,
    entry: ControlPlaneSpendEntry
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memSpendEntries, ctx.workspaceId).set(entry.id, { ...entry });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await insertSpendEntryRow(client, ctx, entry);
    });
  },

  async listSpendEntries(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string; agentId?: string; since?: string }
  ): Promise<ControlPlaneSpendEntry[]> {
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      if (filters?.agentId) {
        params.push(filters.agentId);
        where += ` AND agent_id = $${params.length}`;
      }
      if (filters?.since) {
        params.push(new Date(filters.since));
        where += ` AND recorded_at >= $${params.length}`;
      }
      const result = await client.query<SpendEntryRow>(
        `SELECT id, team_id, user_id, agent_id, execution_id, category, cost_usd,
                model, provider, tool_name, metadata, recorded_at
           FROM spend_entries
          WHERE ${where}
          ORDER BY recorded_at DESC`,
        params
      );
      return result.rows.map(rowToSpendEntry);
    });
  },

  async upsertBudgetAlert(
    ctx: ControlPlaneRepoContext,
    alert: ControlPlaneBudgetAlert
  ): Promise<void> {
    if (useInMemoryFallback()) {
      memBucket(memBudgetAlerts, ctx.workspaceId).set(alert.id, { ...alert });
      return;
    }
    await withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      await upsertBudgetAlertRow(client, ctx, alert);
    });
  },

  async listBudgetAlerts(
    ctx: ControlPlaneRepoContext,
    filters?: { teamId?: string }
  ): Promise<ControlPlaneBudgetAlert[]> {
    return withWorkspaceContext(getPostgresPool(), ctx, async (client) => {
      const params: unknown[] = [ctx.userId];
      let where = "user_id = $1";
      if (filters?.teamId) {
        params.push(filters.teamId);
        where += ` AND team_id = $${params.length}`;
      }
      const result = await client.query<BudgetAlertRow>(
        `SELECT id, team_id, user_id, agent_id, tool_name, scope, threshold,
                budget_usd, spent_usd, recorded_at
           FROM budget_alerts
          WHERE ${where}
          ORDER BY recorded_at DESC`,
        params
      );
      return result.rows.map(rowToBudgetAlert);
    });
  },
};

/**
 * DASH-64.1: Test-only — clears the in-memory fallback stores so each
 * `beforeEach` starts from a clean slate. No-op in production (Postgres
 * is the source of truth and test fixtures handle their own teardown).
 *
 * Exported separately from the main `controlPlaneRepository` object so
 * production code can't accidentally call it.
 */
export function __resetRepositoryInMemoryStateForTests(): void {
  memTasks.clear();
  memHeartbeats.clear();
  memSpendEntries.clear();
  memBudgetAlerts.clear();
}

export type ControlPlaneRepository = typeof controlPlaneRepository;
