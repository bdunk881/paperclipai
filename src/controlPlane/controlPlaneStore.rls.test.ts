describe("controlPlaneStore RLS integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  const userId = "control-plane-rls-user";
  const workspaceOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspaceTwo = "22222222-2222-4222-8222-222222222222";
  let canRunIntegration = false;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("../db/postgres");
    const migrations = await import("../db/sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    const controlPlane = await import("./controlPlaneStore");
    return { postgres, migrations, workspaceContext, controlPlane };
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

    const { postgres, controlPlane } = await loadModules();
    await postgres.queryPostgres("DELETE FROM control_plane_executions WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_agents WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_teams WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM provisioned_companies WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspaces WHERE owner_user_id = $1", [userId]);
    controlPlane.controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();
  });

  it("keeps hydrated in-memory team reads scoped per workspace and enforces RLS at runtime", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext, controlPlane } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id)
       VALUES ($1, $2, $3), ($4, $5, $3)`,
      [workspaceOne, "Workspace One", userId, workspaceTwo, "Workspace Two"]
    );

    const teamOne = await controlPlane.controlPlaneStore.createTeam({
      workspaceId: workspaceOne,
      userId,
      name: "Tenant One Team",
    });
    const teamTwo = await controlPlane.controlPlaneStore.createTeam({
      workspaceId: workspaceTwo,
      userId,
      name: "Tenant Two Team",
    });

    await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceOne, userId);
    await controlPlane.controlPlaneStore.ensureWorkspaceHydrated(workspaceTwo, userId);

    expect(controlPlane.controlPlaneStore.listTeams(userId, workspaceOne).map((team) => team.id)).toEqual([teamOne.id]);
    expect(controlPlane.controlPlaneStore.listTeams(userId, workspaceTwo).map((team) => team.id)).toEqual([teamTwo.id]);

    const pool = postgres.getPostgresPool();

    await expect(
      workspaceContext.withWorkspaceContext(pool, { workspaceId: workspaceTwo, userId }, async (client) => {
        const result = await client.query("SELECT id FROM control_plane_teams WHERE id = $1", [teamOne.id]);
        expect(result.rowCount ?? result.rows.length).toBe(0);
      })
    ).resolves.toBeUndefined();

    await expect(
      workspaceContext.withWorkspaceContext(pool, { workspaceId: workspaceOne, userId }, async (client) => {
        await client.query(
          `INSERT INTO control_plane_teams (
             id, workspace_id, user_id, name, deployment_mode, status, paused_by_company_lifecycle,
             restart_count, budget_monthly_usd, tool_budget_ceilings, alert_thresholds,
             orchestration_enabled, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, 'workflow_runtime', 'active', false,
             0, 0, '{}'::jsonb, '[0.8,0.9,1]'::jsonb, true, NOW(), NOW()
           )`,
          ["33333333-3333-4333-8333-333333333333", workspaceTwo, userId, "Should Fail"]
        );
      })
    ).rejects.toThrow();
  });
});
