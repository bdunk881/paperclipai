import { randomUUID } from "crypto";

/**
 * Phase 4.2b (ALT-2056) hydration round-trip integration tests for
 * controlPlaneStore.
 *
 * These cover AC4 of ALT-2048: prove PG is the source of truth across a
 * process restart for the four maps wired up in commit 1aab226 — tasks,
 * heartbeats, spend entries, and budget alerts.
 *
 * The pattern per case:
 *   1. record state through the public store API
 *   2. drop in-memory state (`controlPlaneStore.clear()`) and the PG pool
 *      (`closePostgresPoolForTests()`) — together this simulates a process
 *      restart from the store's perspective
 *   3. re-import the modules and call `ensureWorkspaceHydrated`, which is
 *      the same hydration entrypoint a fresh worker boot would hit
 *   4. assert the row is observable through the matching `list*` /
 *      snapshot accessor
 *
 * Each case uses unique workspace, team, and agent ids so rows do not leak
 * across cases (and so the partial unique indexes on budget_alerts cannot
 * collide across cases).
 */
describe("controlPlaneStore (Phase 4.2b) hydration round-trip", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  const userId = "control-plane-hydration-rls-user";
  let canRunIntegration = false;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("../db/postgres");
    const migrations = await import("../db/sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    const controlPlane = await import("./controlPlaneStore");
    return { postgres, migrations, workspaceContext, controlPlane };
  }

  async function seedWorkspaceTeamAgent(input: {
    workspaceId: string;
    teamId: string;
    agentId: string;
    label: string;
    teamBudgetUsd?: number;
    alertThresholds?: number[];
  }): Promise<void> {
    const { postgres, workspaceContext } = await loadModules();
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, $2, $3)`,
      [input.workspaceId, `${input.label} Workspace`, userId]
    );
    const teamBudget = input.teamBudgetUsd ?? 0;
    const thresholds = input.alertThresholds ?? [0.8, 0.9, 1];
    const pool = postgres.getPostgresPool();
    await workspaceContext.withWorkspaceContext(
      pool,
      { workspaceId: input.workspaceId, userId },
      async (client) => {
        await client.query(
          `INSERT INTO control_plane_teams (
             id, workspace_id, user_id, name, deployment_mode, status,
             paused_by_company_lifecycle, restart_count, budget_monthly_usd,
             tool_budget_ceilings, alert_thresholds, orchestration_enabled,
             created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, 'workflow_runtime', 'active',
             false, 0, $5,
             '{}'::jsonb, $6::jsonb, true,
             NOW(), NOW()
           )`,
          [
            input.teamId,
            input.workspaceId,
            userId,
            `${input.label} Team`,
            teamBudget,
            JSON.stringify(thresholds),
          ]
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
          [
            input.agentId,
            input.workspaceId,
            userId,
            input.teamId,
            `${input.label} Agent`,
          ]
        );
      }
    );
  }

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
    if (!process.env.DATABASE_URL?.trim()) {
      return;
    }
    const { postgres } = await loadModules();
    canRunIntegration = await postgres.checkPostgresConnection();
    if (canRunIntegration) {
      const { migrations } = await loadModules();
      await migrations.ensureSqlMigrationsApplied();
    }
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
    const { postgres, controlPlane } = await loadModules();
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
    await postgres.queryPostgres(
      "DELETE FROM control_plane_tasks WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres(
      "DELETE FROM control_plane_agents WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres(
      "DELETE FROM control_plane_teams WHERE user_id = $1",
      [userId]
    );
    await postgres.queryPostgres(
      "DELETE FROM workspaces WHERE owner_user_id = $1",
      [userId]
    );
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();
  });

  it("rehydrates a recorded task across a simulated restart", async () => {
    if (!canRunIntegration) {
      return;
    }

    const workspaceId = randomUUID();
    const teamId = randomUUID();
    const agentId = randomUUID();
    await seedWorkspaceTeamAgent({ workspaceId, teamId, agentId, label: "Tasks" });

    // First boot: hydrate, create the task, then simulate a restart.
    {
      const { controlPlane } = await loadModules();
      await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const created = await controlPlane.controlPlaneStore.createTask({
        userId,
        teamId,
        title: "Tasks round-trip",
        description: "Survives a restart",
        actor: "system",
      });
      expect(controlPlane.controlPlaneStore.listTasks(userId, teamId).map((t) => t.id)).toEqual([
        created.id,
      ]);
    }

    const { postgres, controlPlane } = await loadModules();
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();

    // Second boot: empty in-memory state, fresh pool. The task should come
    // back from PG via ensureWorkspaceHydrated.
    {
      const fresh = await loadModules();
      await fresh.controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const restored = fresh.controlPlane.controlPlaneStore.listTasks(userId, teamId);
      expect(restored).toHaveLength(1);
      expect(restored[0].title).toBe("Tasks round-trip");
      expect(restored[0].teamId).toBe(teamId);
    }
  });

  it("rehydrates a recorded heartbeat across a simulated restart", async () => {
    if (!canRunIntegration) {
      return;
    }

    const workspaceId = randomUUID();
    const teamId = randomUUID();
    const agentId = randomUUID();
    await seedWorkspaceTeamAgent({ workspaceId, teamId, agentId, label: "Heartbeats" });

    let recordedHeartbeatId: string;
    {
      const { controlPlane } = await loadModules();
      await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const heartbeat = await controlPlane.controlPlaneStore.recordHeartbeat({
        workspaceId,
        userId,
        teamId,
        agentId,
        status: "completed",
        summary: "round-trip check",
      });
      recordedHeartbeatId = heartbeat.id;
      expect(controlPlane.controlPlaneStore.listHeartbeats(userId, teamId).map((h) => h.id)).toEqual([
        heartbeat.id,
      ]);
    }

    const { postgres, controlPlane } = await loadModules();
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();

    {
      const fresh = await loadModules();
      await fresh.controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const restored = fresh.controlPlane.controlPlaneStore.listHeartbeats(userId, teamId);
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe(recordedHeartbeatId);
      expect(restored[0].status).toBe("completed");
      expect(restored[0].agentId).toBe(agentId);
    }
  });

  it("rehydrates a recorded spend entry across a simulated restart", async () => {
    if (!canRunIntegration) {
      return;
    }

    const workspaceId = randomUUID();
    const teamId = randomUUID();
    const agentId = randomUUID();
    await seedWorkspaceTeamAgent({
      workspaceId,
      teamId,
      agentId,
      label: "Spend",
      teamBudgetUsd: 100,
    });

    let recordedSpendId: string;
    {
      const { controlPlane } = await loadModules();
      await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const entry = await controlPlane.controlPlaneStore.recordSpend({
        userId,
        teamId,
        agentId,
        category: "llm",
        costUsd: 1.25,
        provider: "anthropic",
      });
      recordedSpendId = entry.id;
      expect(
        controlPlane.controlPlaneStore.listSpendEntries(userId, { teamId }).map((e) => e.id)
      ).toEqual([entry.id]);
    }

    const { postgres, controlPlane } = await loadModules();
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();

    {
      const fresh = await loadModules();
      await fresh.controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      const restored = fresh.controlPlane.controlPlaneStore.listSpendEntries(userId, { teamId });
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe(recordedSpendId);
      const snapshot = fresh.controlPlane.controlPlaneStore.getTeamSpendSnapshot(teamId, userId);
      expect(snapshot?.team.spentUsd).toBe(1.25);
    }
  });

  it("rehydrates a budget alert and reproduces the dedupe key across a restart", async () => {
    if (!canRunIntegration) {
      return;
    }

    const workspaceId = randomUUID();
    const teamId = randomUUID();
    const agentId = randomUUID();
    // Budget = $1, thresholds at 80% / 90% / 100%. First spend $0.81 trips the
    // 80% team threshold and writes a budget alert; the 0.9 / 1.0 thresholds
    // remain untriggered. A second spend in the same period that keeps spend
    // under 90% must dedupe to the same alert row, not duplicate it.
    await seedWorkspaceTeamAgent({
      workspaceId,
      teamId,
      agentId,
      label: "Alerts",
      teamBudgetUsd: 1,
      alertThresholds: [0.8, 0.9, 1],
    });

    {
      const { controlPlane } = await loadModules();
      await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);
      await controlPlane.controlPlaneStore.recordSpend({
        userId,
        teamId,
        agentId,
        category: "llm",
        costUsd: 0.81,
        provider: "anthropic",
      });
      const alerts = controlPlane.controlPlaneStore.listBudgetAlerts(userId, teamId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].scope).toBe("team");
      expect(alerts[0].threshold).toBe(0.8);
    }

    const { postgres, controlPlane } = await loadModules();
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();

    {
      const fresh = await loadModules();
      await fresh.controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceId, userId);

      const rehydrated = fresh.controlPlane.controlPlaneStore.listBudgetAlerts(userId, teamId);
      expect(rehydrated).toHaveLength(1);
      expect(rehydrated[0].scope).toBe("team");
      expect(rehydrated[0].threshold).toBe(0.8);
      expect(rehydrated[0].budgetUsd).toBe(1);

      // Second spend keeps total under 90% so only the 80% threshold trips
      // again — the dedupe key in budgetAlertDedupeKey must reproduce from the
      // hydrated alert and short-circuit the upsert, leaving exactly one row.
      await fresh.controlPlane.controlPlaneStore.recordSpend({
        userId,
        teamId,
        agentId,
        category: "llm",
        costUsd: 0.05,
        provider: "anthropic",
      });

      const finalAlerts = fresh.controlPlane.controlPlaneStore.listBudgetAlerts(userId, teamId);
      expect(finalAlerts).toHaveLength(1);
      expect(finalAlerts[0].id).toBe(rehydrated[0].id);

      // PG-level invariant: the partial unique index on (team_id, threshold)
      // means at most one row exists for this scope, regardless of dedupe key.
      const pg = await fresh.postgres.queryPostgres<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM control_plane_budget_alerts WHERE team_id = $1 AND scope = 'team'",
        [teamId]
      );
      expect(Number(pg.rows[0].count)).toBe(1);
    }
  });
});
