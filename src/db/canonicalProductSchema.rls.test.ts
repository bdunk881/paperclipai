import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

describe("canonical product schema RLS integration (HEL-13)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  const userId = "hel-13-seed-user";
  const workspaceId = "13131313-1313-4131-8131-131313131313";
  const otherWorkspaceId = "23232323-2323-4232-8232-232323232323";
  const seedCompanyId = "13131313-1313-4131-8131-131313131301";
  const seedMissionId = "13131313-1313-4131-8131-131313131302";
  const seedHiringPlanId = "13131313-1313-4131-8131-131313131303";
  let canRunIntegration = false;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("./postgres");
    const migrations = await import("./sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    return { postgres, migrations, workspaceContext };
  }

  async function cleanup(): Promise<void> {
    const { postgres, workspaceContext } = await loadModules();
    const pool = postgres.getPostgresPool();

    await workspaceContext.withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
      await client.query(
        "DELETE FROM hiring_plans WHERE id = $1 OR mission_id = $2",
        [seedHiringPlanId, seedMissionId]
      );
      await client.query(
        "DELETE FROM missions WHERE id = $1 OR company_id = $2",
        [seedMissionId, seedCompanyId]
      );
      await client.query(
        "DELETE FROM companies WHERE id = $1 OR workspace_id = $2",
        [seedCompanyId, workspaceId]
      );
      await client.query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, userId]
      );
      await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    });

    await postgres.queryPostgres("DELETE FROM user_profiles WHERE user_id = $1", [userId]);
    await postgres.closePostgresPoolForTests();
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

    await cleanup();
  });

  it("seeds and isolates companies, missions, and hiring plans by workspace", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    const seedSql = readFileSync(
      path.resolve(__dirname, "..", "..", "test", "fixtures", "hel_13_companies_missions_hiring_plans_seed.sql"),
      "utf8"
    );
    await postgres.queryPostgres(seedSql);

    const pool = postgres.getPostgresPool();
    const ctx = { workspaceId, userId };
    const otherCtx = { workspaceId: otherWorkspaceId, userId };

    await workspaceContext.withWorkspaceContext(pool, ctx, async (client) => {
      const companies = await client.query("SELECT id, description FROM companies WHERE id = $1", [seedCompanyId]);
      expect(companies.rows).toEqual([
        {
          id: seedCompanyId,
          description: "Sample tenant company for canonical schema tests.",
        },
      ]);

      const missions = await client.query("SELECT id, statement FROM missions WHERE id = $1", [seedMissionId]);
      expect(missions.rowCount).toBe(1);

      const hiringPlans = await client.query("SELECT id, draft FROM hiring_plans WHERE id = $1", [seedHiringPlanId]);
      expect(hiringPlans.rowCount).toBe(1);
      expect(hiringPlans.rows[0]?.draft).toHaveProperty("agents");
    });

    await workspaceContext.withWorkspaceContext(pool, otherCtx, async (client) => {
      expect((await client.query("SELECT id FROM companies WHERE id = $1", [seedCompanyId])).rowCount).toBe(0);
      expect((await client.query("SELECT id FROM missions WHERE id = $1", [seedMissionId])).rowCount).toBe(0);
      expect((await client.query("SELECT id FROM hiring_plans WHERE id = $1", [seedHiringPlanId])).rowCount).toBe(0);
    });

    const nullContextClient = await pool.connect();
    try {
      await nullContextClient.query("RESET app.current_workspace_id");
      await nullContextClient.query("RESET app.current_user_id");
      expect((await nullContextClient.query("SELECT id FROM companies WHERE id = $1", [seedCompanyId])).rowCount).toBe(0);
      expect((await nullContextClient.query("SELECT id FROM missions WHERE id = $1", [seedMissionId])).rowCount).toBe(0);
      expect((await nullContextClient.query("SELECT id FROM hiring_plans WHERE id = $1", [seedHiringPlanId])).rowCount).toBe(0);
    } finally {
      nullContextClient.release();
    }
  });

  it("allows canonical company rows without legacy provisioning fields", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();
    await postgres.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, "HEL-13 Seed User"]
    );
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [workspaceId, "HEL-13 Seed Workspace", userId]
    );

    const companyId = randomUUID();
    const missionId = randomUUID();
    const hiringPlanId = randomUUID();
    const pool = postgres.getPostgresPool();

    await workspaceContext.withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
      await client.query(
        `INSERT INTO companies (id, workspace_id, name, description)
         VALUES ($1, $2, $3, $4)`,
        [companyId, workspaceId, "Canonical Company", "No legacy provisioning fields required."]
      );
      await client.query(
        `INSERT INTO missions (id, company_id, statement, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [missionId, companyId, "Describe the customer mission.", "draft", userId]
      );
      await client.query(
        `INSERT INTO hiring_plans (id, mission_id, draft)
         VALUES ($1, $2, $3::jsonb)`,
        [hiringPlanId, missionId, JSON.stringify({ agents: [] })]
      );

      const result = await client.query(
        `SELECT hiring_plans.id
           FROM hiring_plans
           JOIN missions ON missions.id = hiring_plans.mission_id
           JOIN companies ON companies.id = missions.company_id
          WHERE companies.id = $1`,
        [companyId]
      );
      expect(result.rows.map((row) => row.id)).toEqual([hiringPlanId]);
    });
  });
});
