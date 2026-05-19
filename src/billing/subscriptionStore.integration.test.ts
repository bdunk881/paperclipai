/**
 * HEL-72: Integration test — subscriptionStore round-trip with live Postgres.
 *
 * Proves that after a subscription write reaches Postgres (the path taken by
 * every Stripe webhook handler via billingRepository.upsertSubscriptionAndEntitlements),
 * clearing the in-memory cache and calling hydrateFromPostgres() fully restores
 * all three lookup indexes.  This is the restart-survival contract introduced
 * in HEL-45.
 *
 * Skipped automatically when DATABASE_URL is absent (local dev without a
 * Postgres container).  CI sets DATABASE_URL via the postgres service attached
 * to the test-api-integration job.
 *
 * Design notes:
 * - jest.resetModules() is intentionally absent: isPostgresPersistenceEnabled()
 *   reads process.env at call time, not at module-load time.  Deleting
 *   JEST_WORKER_ID in beforeAll is sufficient to enable persistence.
 * - Modules are imported once in beforeAll and reused.  Dynamic imports inside
 *   each test body would have cleared migrationPromise via jest.resetModules(),
 *   causing re-application of migrations; migration 001 has CREATE POLICY
 *   without IF NOT EXISTS guards and fails on a second apply.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("subscriptionStore hydration integration (HEL-72)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;

  const userId = "hel72-integration-user";
  const workspaceId = "72727272-7272-4272-8272-727272727272";
  const stripeSubId = "sub_hel72_integration_test";
  const stripeCustomerId = "cus_hel72_integration_test";
  const email = "hel72-integration@example.com";

  let canRunIntegration = false;

  // Shared module instances set once in beforeAll and reused across tests.
  let pg: any;
  let billing: any;
  let store: any;

  beforeAll(async () => {
    // Remove Jest's worker marker so isPostgresPersistenceEnabled() returns true.
    delete process.env.JEST_WORKER_ID;
    if (!process.env.DATABASE_URL?.trim()) {
      return;
    }

    try {
      pg = await import("../db/postgres");
      const migrations = await import("../db/sqlMigrations");
      billing = await import("./billingRepository");
      store = await import("./subscriptionStore");

      canRunIntegration = await pg.checkPostgresConnection();
      if (canRunIntegration) {
        await migrations.ensureSqlMigrationsApplied();
      }
    } catch (err) {
      console.error("[HEL-72] beforeAll setup failed:", err);
      canRunIntegration = false;
    }
  }, 120_000);

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
    if (pg) {
      await pg.closePostgresPoolForTests().catch((err: unknown) => {
        console.error("[HEL-72] pool close failed:", err);
      });
    }
  }, 30_000);

  afterEach(async () => {
    if (!canRunIntegration) return;
    await pg.queryPostgres(
      `DELETE FROM subscriptions WHERE stripe_subscription_id LIKE $1`,
      [stripeSubId + "%"],
    );
    await pg.queryPostgres(
      `DELETE FROM entitlements WHERE workspace_id = $1`,
      [workspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
  });

  it(
    "subscription written via billingRepository survives a simulated restart and all three lookup indexes are restored by hydrateFromPostgres",
    async () => {
      if (!canRunIntegration) return;

      // Seed: user_profile + workspace (workspace FK required by subscriptions table)
      await pg.queryPostgres(
        `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId, "HEL-72 Integration User"],
      );
      await pg.queryPostgres(
        `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [workspaceId, "HEL-72 Integration Workspace", userId],
      );

      const now = new Date().toISOString();
      const periodStart = new Date(Date.UTC(2026, 3, 1)).toISOString();
      const periodEnd = new Date(Date.UTC(2026, 4, 1)).toISOString();

      // Step 1: simulate the write that every Stripe webhook handler performs
      await billing.billingRepository.upsertSubscriptionAndEntitlements({
        workspaceId,
        userId,
        email,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
        plan: "flow",
        status: "active",
        accessLevel: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
      });

      // Step 2: seed the in-memory store as the webhook handler would.
      store.subscriptionStore.upsert({
        id: "hel72-test-id",
        workspaceId,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
        userId,
        email,
        tier: "flow",
        accessLevel: "active",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        createdAt: now,
        updatedAt: now,
      });

      // Step 3: verify the Postgres row was written with all columns from migration 028
      const pgResult = await pg.queryPostgres(
        `SELECT stripe_subscription_id, stripe_customer_id, user_id, email,
                plan, status, access_level,
                current_period_start, current_period_end,
                cancel_at_period_end, trial_end
           FROM subscriptions
          WHERE stripe_subscription_id = $1`,
        [stripeSubId],
      );

      expect(pgResult.rows).toHaveLength(1);
      const row = pgResult.rows[0];
      expect(row.stripe_subscription_id).toBe(stripeSubId);
      expect(row.stripe_customer_id).toBe(stripeCustomerId);
      expect(row.user_id).toBe(userId);
      expect(row.email).toBe(email);
      expect(row.plan).toBe("flow");
      expect(row.status).toBe("active");
      expect(row.access_level).toBe("active");
      expect(row.cancel_at_period_end).toBe(false);
      expect(row.trial_end).toBeNull();
      expect(row.current_period_start).toBeTruthy();
      expect(row.current_period_end).toBeTruthy();

      // Step 4: simulate restart by wiping the in-memory cache
      store.subscriptionStore.clear();
      expect(await store.subscriptionStore.getByStripeSubscriptionId(stripeSubId)).toBeUndefined();
      expect(await store.subscriptionStore.getByUserId(userId)).toBeUndefined();
      expect(await store.subscriptionStore.getByStripeCustomerId(stripeCustomerId)).toHaveLength(0);

      // Step 5: hydrate from Postgres — this is what app.ts calls on startup
      const hydratedCount = await store.subscriptionStore.hydrateFromPostgres();
      expect(hydratedCount).toBeGreaterThanOrEqual(1);

      // Step 6: verify all three lookup indexes are restored with the correct shape
      const bySubId = await store.subscriptionStore.getByStripeSubscriptionId(stripeSubId);
      expect(bySubId).toBeDefined();
      expect(bySubId?.stripeSubscriptionId).toBe(stripeSubId);
      expect(bySubId?.stripeCustomerId).toBe(stripeCustomerId);
      expect(bySubId?.userId).toBe(userId);
      expect(bySubId?.email).toBe(email);
      expect(bySubId?.tier).toBe("flow");
      expect(bySubId?.accessLevel).toBe("active");
      expect(bySubId?.status).toBe("active");
      expect(bySubId?.cancelAtPeriodEnd).toBe(false);
      expect(bySubId?.trialEnd).toBeNull();
      expect(bySubId?.currentPeriodStart).toBeTruthy();
      expect(bySubId?.currentPeriodEnd).toBeTruthy();

      const byUserId = await store.subscriptionStore.getByUserId(userId);
      expect(byUserId).toBeDefined();
      expect(byUserId?.stripeSubscriptionId).toBe(stripeSubId);

      const byCustomerId = await store.subscriptionStore.getByStripeCustomerId(stripeCustomerId);
      expect(byCustomerId).toHaveLength(1);
      expect(byCustomerId[0].stripeSubscriptionId).toBe(stripeSubId);
    },
    60_000,
  );

  it(
    "hydrateFromPostgres does not silently drop a row when multiple subscriptions exist",
    async () => {
      if (!canRunIntegration) return;

      await pg.queryPostgres(
        `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId, "HEL-72 Integration User"],
      );
      await pg.queryPostgres(
        `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [workspaceId, "HEL-72 Integration Workspace", userId],
      );

      const periodStart = new Date(Date.UTC(2026, 3, 1)).toISOString();
      const periodEnd = new Date(Date.UTC(2026, 4, 1)).toISOString();

      const stripeSubId2 = `${stripeSubId}_second`;
      await billing.billingRepository.upsertSubscriptionAndEntitlements({
        workspaceId,
        userId,
        email,
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId,
        plan: "flow",
        status: "active",
        accessLevel: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEnd: null,
      });
      // Insert second sub directly since upsertSubscriptionAndEntitlements updates
      // the entitlements row via ON CONFLICT; the subscription row gets a new
      // stripe_subscription_id so it's a fresh insert.
      await pg.queryPostgres(
        `INSERT INTO subscriptions (workspace_id, stripe_subscription_id, stripe_customer_id,
          user_id, email, plan, status, access_level, current_period_start, current_period_end,
          cancel_at_period_end, trial_end)
         VALUES ($1,$2,$3,$4,$5,'automate','active','active',$6::timestamptz,$7::timestamptz,false,null)
         ON CONFLICT (stripe_subscription_id) DO NOTHING`,
        [workspaceId, stripeSubId2, stripeCustomerId, userId, email, periodStart, periodEnd],
      );

      store.subscriptionStore.clear();

      const hydratedCount = await store.subscriptionStore.hydrateFromPostgres();
      expect(hydratedCount).toBeGreaterThanOrEqual(2);

      expect(await store.subscriptionStore.getByStripeSubscriptionId(stripeSubId)).toBeDefined();
      expect(await store.subscriptionStore.getByStripeSubscriptionId(stripeSubId2)).toBeDefined();
    },
    60_000,
  );
});
