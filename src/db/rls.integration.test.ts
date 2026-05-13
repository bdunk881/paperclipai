import { randomUUID } from "crypto";
import type { Pool } from "pg";

/**
 * HEL-70 — Live cross-tenant RLS integration test (Postgres-backed).
 *
 * Migration 027 (rls_audit_close_gaps) added FORCE ROW LEVEL SECURITY to
 * five tables that previously had tenant_isolation policies but lacked the
 * FORCE directive, and added a workspace-scoped policy to `approvals` that
 * joins through `runs`.  This test proves that all P1 tables covered by
 * migration 027's scope actually enforce isolation when queried through the
 * `withWorkspaceContext` helper (i.e. under the API role, not the migration
 * superuser).
 *
 * Tables covered:
 *   workflows, workflow_versions, routines, runs, step_results
 *   (FORCE RLS added in 027)
 *
 *   activity_events, connector_connections, llm_credentials, budgets,
 *   subscriptions, entitlements
 *   (already had FORCE RLS from migrations 024-025 but not yet live-tested)
 *
 *   approvals
 *   (workspace policy via JOIN through runs added in 027)
 *
 *   audit_log
 *   (workspace isolation + RESTRICTIVE no-update / no-delete from 021/025)
 *
 * Tests that already cover companies / missions / hiring_plans:
 *   src/db/canonicalProductSchema.rls.test.ts  (HEL-13)
 *
 * Tests that already cover agent_tasks / agent_heartbeats / spend_entries /
 * budget_alerts:
 *   src/controlPlane/controlPlaneRepository.rls.test.ts  (ALT-2042)
 */

describe("P1 table RLS integration (HEL-70)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;

  const userA = "hel70-rls-user-a";
  const userB = "hel70-rls-user-b";
  const workspaceA = "70707070-7070-4070-8070-707070707070";
  const workspaceB = "71717171-7171-4171-8171-717171717171";

  let canRunIntegration = false;

  // IDs seeded by seedAll(); reset per-test in afterEach cleanup.
  let wfA: string, wfB: string;
  let wfvA: string, wfvB: string;
  let routineA: string, routineB: string;
  let runA: string, runB: string;
  let stepA: string, stepB: string;
  let approvalA: string, approvalB: string;
  let auditA: string, auditB: string;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("./postgres");
    const migrations = await import("./sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    return { postgres, migrations, workspaceContext };
  }

  async function seedAll(pool: Pool, withWsCtx: typeof import("../middleware/workspaceContext").withWorkspaceContext) {
    wfA = randomUUID();
    wfB = randomUUID();
    wfvA = randomUUID();
    wfvB = randomUUID();
    routineA = randomUUID();
    routineB = randomUUID();
    runA = randomUUID();
    runB = randomUUID();
    stepA = randomUUID();
    stepB = randomUUID();
    approvalA = randomUUID();
    approvalB = randomUUID();
    auditA = randomUUID();
    auditB = randomUUID();

    await withWsCtx(pool, { workspaceId: workspaceA, userId: userA }, async (client) => {
      await client.query(
        `INSERT INTO workflows (id, workspace_id, name) VALUES ($1, $2, 'WF-A')`,
        [wfA, workspaceA]
      );
      await client.query(
        `INSERT INTO workflow_versions (id, workflow_id, version, dag) VALUES ($1, $2, 1, '{}'::jsonb)`,
        [wfvA, wfA]
      );
      await client.query(
        `INSERT INTO routines (id, workspace_id, workflow_id, name, trigger_kind) VALUES ($1, $2, $3, 'Routine-A', 'manual')`,
        [routineA, workspaceA, wfA]
      );
      await client.query(
        `INSERT INTO runs (id, workspace_id, workflow_version_id, status, started_at) VALUES ($1, $2, $3, 'completed', now())`,
        [runA, workspaceA, wfvA]
      );
      await client.query(
        `INSERT INTO step_results (id, run_id, step_id, step_name, status, ordinal) VALUES ($1, $2, 'step-1', 'Step 1', 'success', 1)`,
        [stepA, runA]
      );
      await client.query(
        `INSERT INTO approvals (id, run_id, step_id, tier, status) VALUES ($1, $2, 'gate-1', 'standard', 'pending')`,
        [approvalA, runA]
      );
      await client.query(
        `INSERT INTO activity_events (id, workspace_id, kind, actor, subject, payload) VALUES ($1, $2, 'test.event', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), workspaceA]
      );
      await client.query(
        `INSERT INTO connector_connections (id, workspace_id, kind, oauth_token_ref) VALUES ($1, $2, 'slack', 'tok-a')`,
        [randomUUID(), workspaceA]
      );
      await client.query(
        `INSERT INTO budgets (id, workspace_id, scope_kind, cap_cents, period) VALUES ($1, $2, 'workspace', 100, '2026-05')`,
        [randomUUID(), workspaceA]
      );
      await client.query(
        `INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, plan, status) VALUES ($1, $2, 'sub_a_hel70', 'explore', 'active')`,
        [randomUUID(), workspaceA]
      );
      await client.query(
        `INSERT INTO entitlements (workspace_id, runs_per_month, agent_cap, integration_cap, byok_allowed, log_retention_days, approval_tier_max, plan)
         VALUES ($1, 100, 3, 5, false, 7, 1, 'explore')
         ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceA]
      );
      await client.query(
        `INSERT INTO audit_log (id, workspace_id, actor_user_id, category, action) VALUES ($1, $2, $3, 'auth', 'login')`,
        [auditA, workspaceA, userA]
      );
    });

    await withWsCtx(pool, { workspaceId: workspaceB, userId: userB }, async (client) => {
      await client.query(
        `INSERT INTO workflows (id, workspace_id, name) VALUES ($1, $2, 'WF-B')`,
        [wfB, workspaceB]
      );
      await client.query(
        `INSERT INTO workflow_versions (id, workflow_id, version, dag) VALUES ($1, $2, 1, '{}'::jsonb)`,
        [wfvB, wfB]
      );
      await client.query(
        `INSERT INTO routines (id, workspace_id, workflow_id, name, trigger_kind) VALUES ($1, $2, $3, 'Routine-B', 'manual')`,
        [routineB, workspaceB, wfB]
      );
      await client.query(
        `INSERT INTO runs (id, workspace_id, workflow_version_id, status, started_at) VALUES ($1, $2, $3, 'completed', now())`,
        [runB, workspaceB, wfvB]
      );
      await client.query(
        `INSERT INTO step_results (id, run_id, step_id, step_name, status, ordinal) VALUES ($1, $2, 'step-1', 'Step 1', 'success', 1)`,
        [stepB, runB]
      );
      await client.query(
        `INSERT INTO approvals (id, run_id, step_id, tier, status) VALUES ($1, $2, 'gate-1', 'standard', 'pending')`,
        [approvalB, runB]
      );
      await client.query(
        `INSERT INTO activity_events (id, workspace_id, kind, actor, subject, payload) VALUES ($1, $2, 'test.event', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), workspaceB]
      );
      await client.query(
        `INSERT INTO connector_connections (id, workspace_id, kind, oauth_token_ref) VALUES ($1, $2, 'slack', 'tok-b')`,
        [randomUUID(), workspaceB]
      );
      await client.query(
        `INSERT INTO budgets (id, workspace_id, scope_kind, cap_cents, period) VALUES ($1, $2, 'workspace', 200, '2026-05')`,
        [randomUUID(), workspaceB]
      );
      await client.query(
        `INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, plan, status) VALUES ($1, $2, 'sub_b_hel70', 'explore', 'active')`,
        [randomUUID(), workspaceB]
      );
      await client.query(
        `INSERT INTO entitlements (workspace_id, runs_per_month, agent_cap, integration_cap, byok_allowed, log_retention_days, approval_tier_max, plan)
         VALUES ($1, 100, 3, 5, false, 7, 1, 'explore')
         ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceB]
      );
      await client.query(
        `INSERT INTO audit_log (id, workspace_id, actor_user_id, category, action) VALUES ($1, $2, $3, 'auth', 'login')`,
        [auditB, workspaceB, userB]
      );
    });
  }

  async function cleanup(): Promise<void> {
    const { postgres } = await loadModules();
    // Delete top-down in cascade order; workspace ON DELETE CASCADE handles most children.
    await postgres.queryPostgres(
      `DELETE FROM workspaces WHERE id IN ($1, $2)`,
      [workspaceA, workspaceB]
    );
    await postgres.queryPostgres(
      `DELETE FROM user_profiles WHERE user_id IN ($1, $2)`,
      [userA, userB]
    );
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

  it("isolates workflows, workflow_versions, routines, runs, step_results across workspaces and denies NULL-context reads", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'HEL-70 User A'), ($2, 'HEL-70 User B') ON CONFLICT (user_id) DO NOTHING`,
      [userA, userB]
    );
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, 'HEL-70 WS-A', $3), ($2, 'HEL-70 WS-B', $4) ON CONFLICT (id) DO NOTHING`,
      [workspaceA, workspaceB, userA, userB]
    );

    const pool = postgres.getPostgresPool();
    await seedAll(pool, workspaceContext.withWorkspaceContext);

    const ctxA = { workspaceId: workspaceA, userId: userA };
    const ctxB = { workspaceId: workspaceB, userId: userB };

    // ---- workflows -------------------------------------------------------
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM workflows WHERE id = $1`, [wfA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM workflows WHERE id = $1`, [wfB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM workflows WHERE id = $1`, [wfB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM workflows WHERE id = $1`, [wfA])).rowCount).toBe(0);
    });

    // ---- workflow_versions -----------------------------------------------
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM workflow_versions WHERE id = $1`, [wfvA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM workflow_versions WHERE id = $1`, [wfvB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM workflow_versions WHERE id = $1`, [wfvB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM workflow_versions WHERE id = $1`, [wfvA])).rowCount).toBe(0);
    });

    // ---- routines --------------------------------------------------------
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM routines WHERE id = $1`, [routineA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM routines WHERE id = $1`, [routineB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM routines WHERE id = $1`, [routineB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM routines WHERE id = $1`, [routineA])).rowCount).toBe(0);
    });

    // ---- runs ------------------------------------------------------------
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM runs WHERE id = $1`, [runA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM runs WHERE id = $1`, [runB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM runs WHERE id = $1`, [runB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM runs WHERE id = $1`, [runA])).rowCount).toBe(0);
    });

    // ---- step_results (inherited via runs) --------------------------------
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM step_results WHERE id = $1`, [stepA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM step_results WHERE id = $1`, [stepB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM step_results WHERE id = $1`, [stepB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM step_results WHERE id = $1`, [stepA])).rowCount).toBe(0);
    });

    // ---- NULL workspace context denies all ---------------------------------
    const nullClient = await pool.connect();
    try {
      await nullClient.query("RESET app.current_workspace_id");
      await nullClient.query("RESET app.current_user_id");
      for (const [table, id] of [
        ["workflows", wfA],
        ["workflow_versions", wfvA],
        ["routines", routineA],
        ["runs", runA],
        ["step_results", stepA],
      ] as [string, string][]) {
        const r = await nullClient.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
        expect(r.rowCount ?? r.rows.length).toBe(0);
      }
    } finally {
      nullClient.release();
    }
  });

  it("isolates activity_events, connector_connections, budgets, subscriptions, entitlements across workspaces and denies NULL-context reads", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'HEL-70 User A'), ($2, 'HEL-70 User B') ON CONFLICT (user_id) DO NOTHING`,
      [userA, userB]
    );
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, 'HEL-70 WS-A', $3), ($2, 'HEL-70 WS-B', $4) ON CONFLICT (id) DO NOTHING`,
      [workspaceA, workspaceB, userA, userB]
    );

    const pool = postgres.getPostgresPool();

    const actEvtA = randomUUID();
    const actEvtB = randomUUID();
    const connA = randomUUID();
    const connB = randomUUID();
    const budgetA = randomUUID();
    const budgetB = randomUUID();
    const subA = randomUUID();
    const subB = randomUUID();
    const llmCredIdA = "hel70-llm-cred-a";
    const llmCredIdB = "hel70-llm-cred-b";

    await workspaceContext.withWorkspaceContext(pool, { workspaceId: workspaceA, userId: userA }, async (client) => {
      await client.query(
        `INSERT INTO activity_events (id, workspace_id, kind, actor, subject, payload) VALUES ($1, $2, 'test.event', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [actEvtA, workspaceA]
      );
      await client.query(
        `INSERT INTO connector_connections (id, workspace_id, kind, oauth_token_ref) VALUES ($1, $2, 'github', 'tok-a-sep')`,
        [connA, workspaceA]
      );
      await client.query(
        `INSERT INTO llm_credentials (id, workspace_id, user_id, provider) VALUES ($1, $2, $3, 'anthropic') ON CONFLICT (id) DO NOTHING`,
        [llmCredIdA, workspaceA, userA]
      );
      await client.query(
        `INSERT INTO budgets (id, workspace_id, scope_kind, cap_cents, period) VALUES ($1, $2, 'workspace', 100, '2026-06')`,
        [budgetA, workspaceA]
      );
      await client.query(
        `INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, plan, status) VALUES ($1, $2, 'sub_a2_hel70', 'explore', 'active')`,
        [subA, workspaceA]
      );
      await client.query(
        `INSERT INTO entitlements (workspace_id, runs_per_month, agent_cap, integration_cap, byok_allowed, log_retention_days, approval_tier_max, plan)
         VALUES ($1, 50, 1, 2, false, 3, 0, 'explore')
         ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceA]
      );
    });

    await workspaceContext.withWorkspaceContext(pool, { workspaceId: workspaceB, userId: userB }, async (client) => {
      await client.query(
        `INSERT INTO activity_events (id, workspace_id, kind, actor, subject, payload) VALUES ($1, $2, 'test.event', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [actEvtB, workspaceB]
      );
      await client.query(
        `INSERT INTO connector_connections (id, workspace_id, kind, oauth_token_ref) VALUES ($1, $2, 'github', 'tok-b-sep')`,
        [connB, workspaceB]
      );
      await client.query(
        `INSERT INTO llm_credentials (id, workspace_id, user_id, provider) VALUES ($1, $2, $3, 'anthropic') ON CONFLICT (id) DO NOTHING`,
        [llmCredIdB, workspaceB, userB]
      );
      await client.query(
        `INSERT INTO budgets (id, workspace_id, scope_kind, cap_cents, period) VALUES ($1, $2, 'workspace', 200, '2026-06')`,
        [budgetB, workspaceB]
      );
      await client.query(
        `INSERT INTO subscriptions (id, workspace_id, stripe_subscription_id, plan, status) VALUES ($1, $2, 'sub_b2_hel70', 'explore', 'active')`,
        [subB, workspaceB]
      );
      await client.query(
        `INSERT INTO entitlements (workspace_id, runs_per_month, agent_cap, integration_cap, byok_allowed, log_retention_days, approval_tier_max, plan)
         VALUES ($1, 50, 1, 2, false, 3, 0, 'explore')
         ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceB]
      );
    });

    const ctxA = { workspaceId: workspaceA, userId: userA };
    const ctxB = { workspaceId: workspaceB, userId: userB };

    // activity_events
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM activity_events WHERE id = $1`, [actEvtA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM activity_events WHERE id = $1`, [actEvtB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM activity_events WHERE id = $1`, [actEvtB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM activity_events WHERE id = $1`, [actEvtA])).rowCount).toBe(0);
    });

    // connector_connections
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM connector_connections WHERE id = $1`, [connA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM connector_connections WHERE id = $1`, [connB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM connector_connections WHERE id = $1`, [connB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM connector_connections WHERE id = $1`, [connA])).rowCount).toBe(0);
    });

    // llm_credentials (workspace-scoped rows)
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM llm_credentials WHERE id = $1`, [llmCredIdA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM llm_credentials WHERE id = $1`, [llmCredIdB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM llm_credentials WHERE id = $1`, [llmCredIdB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM llm_credentials WHERE id = $1`, [llmCredIdA])).rowCount).toBe(0);
    });

    // budgets
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM budgets WHERE id = $1`, [budgetA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM budgets WHERE id = $1`, [budgetB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM budgets WHERE id = $1`, [budgetB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM budgets WHERE id = $1`, [budgetA])).rowCount).toBe(0);
    });

    // subscriptions
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM subscriptions WHERE id = $1`, [subA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM subscriptions WHERE id = $1`, [subB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM subscriptions WHERE id = $1`, [subB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM subscriptions WHERE id = $1`, [subA])).rowCount).toBe(0);
    });

    // entitlements (workspace_id is PK; read own row, not other)
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT workspace_id FROM entitlements WHERE workspace_id = $1`, [workspaceA])).rowCount).toBe(1);
      expect((await client.query(`SELECT workspace_id FROM entitlements WHERE workspace_id = $1`, [workspaceB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT workspace_id FROM entitlements WHERE workspace_id = $1`, [workspaceB])).rowCount).toBe(1);
      expect((await client.query(`SELECT workspace_id FROM entitlements WHERE workspace_id = $1`, [workspaceA])).rowCount).toBe(0);
    });

    // NULL context denies all
    const nullClient = await pool.connect();
    try {
      await nullClient.query("RESET app.current_workspace_id");
      await nullClient.query("RESET app.current_user_id");
      for (const [table, id] of [
        ["activity_events", actEvtA],
        ["connector_connections", connA],
        ["llm_credentials", llmCredIdA],
        ["budgets", budgetA],
        ["subscriptions", subA],
      ] as [string, string][]) {
        const r = await nullClient.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
        expect(r.rowCount ?? r.rows.length).toBe(0);
      }
      const entr = await nullClient.query(
        `SELECT workspace_id FROM entitlements WHERE workspace_id = $1`,
        [workspaceA]
      );
      expect(entr.rowCount ?? entr.rows.length).toBe(0);
    } finally {
      nullClient.release();
    }
  });

  it("approvals: workspace policy (027) hides cross-tenant approvals; NULL context denies", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'HEL-70 User A'), ($2, 'HEL-70 User B') ON CONFLICT (user_id) DO NOTHING`,
      [userA, userB]
    );
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, 'HEL-70 WS-A', $3), ($2, 'HEL-70 WS-B', $4) ON CONFLICT (id) DO NOTHING`,
      [workspaceA, workspaceB, userA, userB]
    );

    const pool = postgres.getPostgresPool();
    await seedAll(pool, workspaceContext.withWorkspaceContext);

    const ctxA = { workspaceId: workspaceA, userId: userA };
    const ctxB = { workspaceId: workspaceB, userId: userB };

    // Workspace A sees its own approval, not B's
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM approvals WHERE id = $1`, [approvalA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM approvals WHERE id = $1`, [approvalB])).rowCount).toBe(0);
    });

    // Workspace B sees its own approval, not A's
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM approvals WHERE id = $1`, [approvalB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM approvals WHERE id = $1`, [approvalA])).rowCount).toBe(0);
    });

    // NULL context: both user and workspace policies deny
    const nullClient = await pool.connect();
    try {
      await nullClient.query("RESET app.current_workspace_id");
      await nullClient.query("RESET app.current_user_id");
      const r = await nullClient.query(`SELECT id FROM approvals WHERE id = $1`, [approvalA]);
      expect(r.rowCount ?? r.rows.length).toBe(0);
    } finally {
      nullClient.release();
    }
  });

  it("audit_log: workspace isolation holds; RESTRICTIVE no-update and no-delete policies reject mutations", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    await postgres.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'HEL-70 User A'), ($2, 'HEL-70 User B') ON CONFLICT (user_id) DO NOTHING`,
      [userA, userB]
    );
    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, 'HEL-70 WS-A', $3), ($2, 'HEL-70 WS-B', $4) ON CONFLICT (id) DO NOTHING`,
      [workspaceA, workspaceB, userA, userB]
    );

    const pool = postgres.getPostgresPool();
    await seedAll(pool, workspaceContext.withWorkspaceContext);

    const ctxA = { workspaceId: workspaceA, userId: userA };
    const ctxB = { workspaceId: workspaceB, userId: userB };

    // Workspace isolation: A sees A, B sees B
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      expect((await client.query(`SELECT id FROM audit_log WHERE id = $1`, [auditA])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM audit_log WHERE id = $1`, [auditB])).rowCount).toBe(0);
    });
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      expect((await client.query(`SELECT id FROM audit_log WHERE id = $1`, [auditB])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM audit_log WHERE id = $1`, [auditA])).rowCount).toBe(0);
    });

    // NULL context denies
    const nullClient = await pool.connect();
    try {
      await nullClient.query("RESET app.current_workspace_id");
      await nullClient.query("RESET app.current_user_id");
      const r = await nullClient.query(`SELECT id FROM audit_log WHERE id = $1`, [auditA]);
      expect(r.rowCount ?? r.rows.length).toBe(0);
    } finally {
      nullClient.release();
    }

    // RESTRICTIVE no-update policy: UPDATE must be rejected even for the row owner
    await expect(
      workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
        await client.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [auditA]);
      })
    ).rejects.toThrow();

    // RESTRICTIVE no-delete policy: DELETE must be rejected even for the row owner
    await expect(
      workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
        await client.query(`DELETE FROM audit_log WHERE id = $1`, [auditA]);
      })
    ).rejects.toThrow();
  });

  it("FORCE RLS guard: test fails cleanly if FORCE RLS is dropped from any P1 table", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    const p1Tables = [
      "workflows",
      "workflow_versions",
      "routines",
      "runs",
      "step_results",
      "activity_events",
      "connector_connections",
      "budgets",
      "subscriptions",
      "entitlements",
      "approvals",
      "audit_log",
    ];

    const result = await postgres.queryPostgres<{ relname: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity AS rowsecurity, relforcerowsecurity AS forcerowsecurity
       FROM pg_class
       WHERE relname = ANY($1)
         AND relkind = 'r'`,
      [p1Tables]
    );

    for (const row of result.rows) {
      expect({ table: row.relname, rowsecurity: row.rowsecurity }).toMatchObject({
        table: row.relname,
        rowsecurity: true,
      });
    }

    const tablesWithForceRls = [
      "workflows",
      "workflow_versions",
      "routines",
      "runs",
      "step_results",
      "activity_events",
      "connector_connections",
      "budgets",
      "subscriptions",
      "entitlements",
      "approvals",
      "audit_log",
    ];
    for (const row of result.rows) {
      if (tablesWithForceRls.includes(row.relname)) {
        expect({ table: row.relname, forcerowsecurity: row.forcerowsecurity }).toMatchObject({
          table: row.relname,
          forcerowsecurity: true,
        });
      }
    }
  });
});
