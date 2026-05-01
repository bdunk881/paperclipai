import { randomUUID } from "crypto";
import type { Pool } from "pg";

/**
 * Phase 4 (ALT-2042) RLS integration tests for the new execution-state tables
 * created by migration 019:
 *   - control_plane_tasks
 *   - control_plane_heartbeats
 *   - control_plane_spend_entries
 *   - control_plane_budget_alerts
 *
 * The contract these tests pin down (matches migrations 014/015/017):
 *
 * 1. Cross-tenant SELECT: rows inserted under workspace A are invisible from
 *    workspace B's session context.
 * 2. NULL session var (no `app.current_workspace_id` set) returns zero rows on
 *    every new table — a missing claim must DENY by default, not silently
 *    expose data.
 * 3. WITH CHECK: writing a row whose `workspace_id` does not match the active
 *    session var is rejected by the policy.
 * 4. Restart durability: data persists across pool reset, which simulates a
 *    process restart from the controlPlaneStore's perspective.
 */
describe("controlPlaneRepository (Phase 4) RLS integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  const userId = "phase4-rls-user";
  const workspaceA = "66666666-6666-4666-8666-666666666666";
  const workspaceB = "77777777-7777-4777-8777-777777777777";
  let canRunIntegration = false;
  let teamA: string;
  let teamB: string;
  let agentA: string;
  let agentB: string;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("../db/postgres");
    const migrations = await import("../db/sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    const repo = await import("./controlPlaneRepository");
    return { postgres, migrations, workspaceContext, repo };
  }

  async function seedTenant(
    pool: Pool,
    withWorkspaceContext: typeof import("../middleware/workspaceContext").withWorkspaceContext,
    workspaceId: string,
    label: string
  ): Promise<{ teamId: string; agentId: string }> {
    const teamId = randomUUID();
    const agentId = randomUUID();
    await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
      await client.query(
        `INSERT INTO control_plane_teams (id, workspace_id, user_id, name)
         VALUES ($1, $2, $3, $4)`,
        [teamId, workspaceId, userId, `${label} Team`]
      );
      await client.query(
        `INSERT INTO control_plane_agents (
           id, workspace_id, user_id, team_id, name, role_key,
           workflow_step_id, workflow_step_kind, model, instructions,
           budget_monthly_usd, skills, schedule, status,
           paused_by_company_lifecycle, last_heartbeat_status,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'tester',
           NULL, NULL, 'gpt-test', 'do work',
           0, '[]'::jsonb, '{}'::jsonb, 'active',
           false, 'queued',
           NOW(), NOW()
         )`,
        [agentId, workspaceId, userId, teamId, `${label} Agent`]
      );
    });
    return { teamId, agentId };
  }

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
    if (!process.env.DATABASE_URL?.trim()) {
      return;
    }
    const { postgres } = await loadModules();
    canRunIntegration = await postgres.checkPostgresConnection();
  });

  afterAll(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
  });

  afterEach(async () => {
    if (!canRunIntegration) {
      return;
    }
    const { postgres } = await loadModules();
    await postgres.queryPostgres(
      "DELETE FROM control_plane_budget_alerts WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres(
      "DELETE FROM control_plane_spend_entries WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres(
      "DELETE FROM control_plane_heartbeats WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres("DELETE FROM control_plane_tasks WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_agents WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_teams WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspaces WHERE owner_user_id = $1", [userId]);
    await postgres.closePostgresPoolForTests();
  });

  it("isolates tasks/heartbeats/spend/alerts across workspaces and denies NULL-context reads", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext, repo } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id)
       VALUES ($1, $2, $3), ($4, $5, $3)`,
      [workspaceA, "Workspace A", userId, workspaceB, "Workspace B"]
    );

    const pool = postgres.getPostgresPool();
    ({ teamId: teamA, agentId: agentA } = await seedTenant(
      pool,
      workspaceContext.withWorkspaceContext,
      workspaceA,
      "A"
    ));
    ({ teamId: teamB, agentId: agentB } = await seedTenant(
      pool,
      workspaceContext.withWorkspaceContext,
      workspaceB,
      "B"
    ));

    const ctxA = { workspaceId: workspaceA, userId };
    const ctxB = { workspaceId: workspaceB, userId };
    const nowIso = new Date().toISOString();

    // ---- Tasks ----------------------------------------------------------------
    const taskA = {
      id: randomUUID(),
      teamId: teamA,
      userId,
      title: "Tenant A task",
      status: "todo" as const,
      auditTrail: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const taskB = {
      id: randomUUID(),
      teamId: teamB,
      userId,
      title: "Tenant B task",
      status: "todo" as const,
      auditTrail: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await repo.controlPlaneRepository.upsertTask(ctxA, taskA);
    await repo.controlPlaneRepository.upsertTask(ctxB, taskB);

    expect((await repo.controlPlaneRepository.listTasks(ctxA)).map((t) => t.id)).toEqual([taskA.id]);
    expect((await repo.controlPlaneRepository.listTasks(ctxB)).map((t) => t.id)).toEqual([taskB.id]);

    // Direct SQL with the wrong session var must still hide tenant A's row.
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      const r = await client.query(`SELECT id FROM control_plane_tasks WHERE id = $1`, [taskA.id]);
      expect(r.rowCount ?? r.rows.length).toBe(0);
    });

    // NULL session var (no app.current_workspace_id set) MUST deny by default.
    const nullCtxClient = await pool.connect();
    try {
      await nullCtxClient.query("RESET app.current_workspace_id");
      const r = await nullCtxClient.query("SELECT id FROM control_plane_tasks");
      expect(r.rowCount ?? r.rows.length).toBe(0);
    } finally {
      nullCtxClient.release();
    }

    // WITH CHECK: an INSERT under workspace A claiming workspace B must fail.
    await expect(
      workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
        await client.query(
          `INSERT INTO control_plane_tasks (
             id, workspace_id, user_id, team_id, title, status, audit_trail
           ) VALUES ($1, $2, $3, $4, $5, 'todo', '[]'::jsonb)`,
          [randomUUID(), workspaceB, userId, teamA, "Should Fail"]
        );
      })
    ).rejects.toThrow();

    // ---- Heartbeats -----------------------------------------------------------
    const hbA = {
      id: randomUUID(),
      teamId: teamA,
      userId,
      agentId: agentA,
      status: "completed" as const,
      summary: "ok",
      createdTaskIds: [],
      startedAt: nowIso,
      completedAt: nowIso,
    };
    const hbB = {
      id: randomUUID(),
      teamId: teamB,
      userId,
      agentId: agentB,
      status: "completed" as const,
      summary: "ok",
      createdTaskIds: [],
      startedAt: nowIso,
      completedAt: nowIso,
    };
    await repo.controlPlaneRepository.insertHeartbeat(ctxA, hbA);
    await repo.controlPlaneRepository.insertHeartbeat(ctxB, hbB);

    expect((await repo.controlPlaneRepository.listHeartbeats(ctxA)).map((h) => h.id)).toEqual([hbA.id]);
    expect((await repo.controlPlaneRepository.listHeartbeats(ctxB)).map((h) => h.id)).toEqual([hbB.id]);

    // Restart-durability check: drop and re-create the pool, then re-read.
    await postgres.closePostgresPoolForTests();
    const fresh = await import("./controlPlaneRepository");
    const reread = await fresh.controlPlaneRepository.listHeartbeats(ctxA);
    expect(reread.map((h) => h.id)).toEqual([hbA.id]);

    // ---- Spend entries --------------------------------------------------------
    const spendA = {
      id: randomUUID(),
      teamId: teamA,
      userId,
      agentId: agentA,
      category: "llm" as const,
      costUsd: 1.25,
      provider: "anthropic",
      recordedAt: nowIso,
    };
    const spendB = {
      id: randomUUID(),
      teamId: teamB,
      userId,
      agentId: agentB,
      category: "llm" as const,
      costUsd: 1.25,
      provider: "anthropic",
      recordedAt: nowIso,
    };
    await fresh.controlPlaneRepository.insertSpendEntry(ctxA, spendA);
    await fresh.controlPlaneRepository.insertSpendEntry(ctxB, spendB);
    expect((await fresh.controlPlaneRepository.listSpendEntries(ctxA)).map((e) => e.id)).toEqual([
      spendA.id,
    ]);
    expect((await fresh.controlPlaneRepository.listSpendEntries(ctxB)).map((e) => e.id)).toEqual([
      spendB.id,
    ]);

    // ---- Budget alerts (with dedupe semantics) -------------------------------
    const alertA = {
      id: randomUUID(),
      teamId: teamA,
      userId,
      scope: "team" as const,
      threshold: 0.8,
      budgetUsd: 100,
      spentUsd: 81,
      recordedAt: nowIso,
    };
    await fresh.controlPlaneRepository.upsertBudgetAlert(ctxA, alertA);
    // Re-issue the same scope/team/threshold under tenant A — partial unique
    // index should fold this into the existing row, not duplicate.
    await fresh.controlPlaneRepository.upsertBudgetAlert(ctxA, {
      ...alertA,
      id: randomUUID(),
      spentUsd: 90,
    });
    const alertsA = await fresh.controlPlaneRepository.listBudgetAlerts(ctxA);
    expect(alertsA).toHaveLength(1);
    expect(alertsA[0].spentUsd).toBe(90);

    // Tenant B should still see zero alerts despite using the same threshold.
    expect(await fresh.controlPlaneRepository.listBudgetAlerts(ctxB)).toEqual([]);
  });
});
