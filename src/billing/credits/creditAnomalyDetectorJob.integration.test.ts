/**
 * HEL-credits-mvp — Postgres integration tests for the anomaly detector.
 *
 * The unit test (creditAnomalyDetectorJob.test.ts) only covers the
 * no-op-when-DB-absent contract. The actual SQL-driven detection
 * logic (hourly spikes, stuck reservations, daily platform spend)
 * needs a real ledger to exercise — that's what this file does.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("credit anomaly detector — Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  const originalWebhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  const originalThreshold = process.env.CREDIT_DAILY_SPEND_ALERT_USD;

  const userId = "anomaly-integration-user";
  const workspaceId = "62626262-6262-4262-8262-626262626262";
  const otherWorkspaceId = "63636363-6363-4363-8363-636363636363";

  let canRunIntegration = false;
  let pg: any;

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
    // Force the alert path through console.warn so we don't need a
    // Slack webhook to test the detector logic.
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    if (!process.env.DATABASE_URL?.trim()) {
      return;
    }
    try {
      pg = await import("../../db/postgres");
      const migrations = await import("../../db/sqlMigrations");
      canRunIntegration = await pg.checkPostgresConnection();
      if (canRunIntegration) {
        await migrations.ensureSqlMigrationsApplied();
      }
    } catch (err) {
      console.error("[anomaly-integration] beforeAll setup failed:", err);
      canRunIntegration = false;
    }
  }, 120_000);

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalJestWorkerId !== undefined) process.env.JEST_WORKER_ID = originalJestWorkerId;
    if (originalWebhookUrl !== undefined) process.env.SLACK_ALERT_WEBHOOK_URL = originalWebhookUrl;
    if (originalThreshold !== undefined) process.env.CREDIT_DAILY_SPEND_ALERT_USD = originalThreshold;
    else delete process.env.CREDIT_DAILY_SPEND_ALERT_USD;
    if (pg) {
      await pg.closePostgresPoolForTests().catch((err: unknown) => {
        console.error("[anomaly-integration] pool close failed:", err);
      });
    }
  }, 30_000);

  beforeEach(async () => {
    if (!canRunIntegration) return;
    const { __resetForTests } = await import("./creditAnomalyDetectorJob");
    __resetForTests();
    // Seed user_profile + workspaces so the FK from ledger holds.
    await pg.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, "Anomaly Integration User"],
    );
    for (const ws of [workspaceId, otherWorkspaceId]) {
      await pg.queryPostgres(
        `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [ws, `Anomaly WS ${ws.slice(0, 8)}`, userId],
      );
    }
  });

  afterEach(async () => {
    if (!canRunIntegration) return;
    await pg.queryPostgres(
      `DELETE FROM workspace_credit_ledger WHERE workspace_id IN ($1, $2)`,
      [workspaceId, otherWorkspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM workspace_credit_wallets WHERE workspace_id IN ($1, $2)`,
      [workspaceId, otherWorkspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM workspaces WHERE id IN ($1, $2)`,
      [workspaceId, otherWorkspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
  });

  /** Seed a fake consumption ledger row with arbitrary created_at offset. */
  async function seedConsumption(args: {
    ws: string;
    credits: number;
    wholesaleUsd?: number;
    minutesAgo: number;
    idempotencyKey: string;
  }): Promise<void> {
    await pg.queryPostgres(
      `INSERT INTO workspace_credit_wallets (workspace_id, balance_credits, lifetime_purchased_credits)
       VALUES ($1, 100000, 100000)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [args.ws],
    );
    await pg.queryPostgres(
      `INSERT INTO workspace_credit_ledger
         (workspace_id, type, credits_delta, balance_after,
          wholesale_cost_usd, retail_cost_usd, markup_multiplier,
          idempotency_key, created_at)
       VALUES (
         $1::uuid, 'consumption', -$2::bigint, 0,
         $3::numeric, $4::numeric, 1.5,
         $5,
         now() - ($6::text || ' minutes')::interval
       )`,
      [
        args.ws,
        args.credits.toString(),
        (args.wholesaleUsd ?? 0).toString(),
        ((args.wholesaleUsd ?? 0) * 1.5).toString(),
        args.idempotencyKey,
        String(args.minutesAgo),
      ],
    );
  }

  /** Seed a fake reservation row with no matching commit. */
  async function seedStuckReservation(args: {
    ws: string;
    credits: number;
    minutesAgo: number;
    idempotencyKey: string;
  }): Promise<void> {
    await pg.queryPostgres(
      `INSERT INTO workspace_credit_wallets (workspace_id, balance_credits, lifetime_purchased_credits)
       VALUES ($1, 100000, 100000)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [args.ws],
    );
    await pg.queryPostgres(
      `INSERT INTO workspace_credit_ledger
         (workspace_id, type, credits_delta, balance_after, idempotency_key, created_at)
       VALUES ($1::uuid, 'reservation', -$2::bigint, 0, $3, now() - ($4::text || ' minutes')::interval)`,
      [args.ws, args.credits.toString(), args.idempotencyKey, String(args.minutesAgo)],
    );
  }

  it("fires no alerts on a quiet workspace with no consumption", async () => {
    if (!canRunIntegration) return;
    const { runCreditAnomalyDetection } = await import("./creditAnomalyDetectorJob");
    const result = await runCreditAnomalyDetection();
    expect(result.spikes).toBe(0);
    expect(result.stuckWorkspaces).toBe(0);
    expect(result.alertsFired).toBe(0);
  });

  it("detects a stuck reservation > 30 min old", async () => {
    if (!canRunIntegration) return;
    // Reservation aged 60 minutes with no matching consumption/release.
    await seedStuckReservation({
      ws: workspaceId,
      credits: 5000,
      minutesAgo: 60,
      idempotencyKey: "stuck_test_call__reserve",
    });

    const { runCreditAnomalyDetection } = await import("./creditAnomalyDetectorJob");
    const result = await runCreditAnomalyDetection();
    expect(result.stuckWorkspaces).toBeGreaterThanOrEqual(1);
    expect(result.alertsFired).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag a reservation that has a matching commit", async () => {
    if (!canRunIntegration) return;
    const callKey = "completed_call";
    // Reservation 60 min old…
    await seedStuckReservation({
      ws: workspaceId,
      credits: 5000,
      minutesAgo: 60,
      idempotencyKey: `${callKey}__reserve`,
    });
    // …with a matching consumption row (the commit). The detector's
    // LIKE-based join finds it by sharing the callKey prefix.
    await seedConsumption({
      ws: workspaceId,
      credits: 5000,
      minutesAgo: 59,
      idempotencyKey: `${callKey}__commit`,
    });

    const { runCreditAnomalyDetection } = await import("./creditAnomalyDetectorJob");
    const result = await runCreditAnomalyDetection();
    expect(result.stuckWorkspaces).toBe(0);
  });

  it("fires daily-platform-spend alert when wholesale crosses threshold", async () => {
    if (!canRunIntegration) return;
    // Threshold is $500 by default; seed > $500 across 2 workspaces.
    await seedConsumption({
      ws: workspaceId,
      credits: 1_000_000,
      wholesaleUsd: 300,
      minutesAgo: 30,
      idempotencyKey: "platform_a",
    });
    await seedConsumption({
      ws: otherWorkspaceId,
      credits: 1_000_000,
      wholesaleUsd: 250,
      minutesAgo: 30,
      idempotencyKey: "platform_b",
    });

    const { runCreditAnomalyDetection } = await import("./creditAnomalyDetectorJob");
    const result = await runCreditAnomalyDetection();
    expect(result.dailyPlatformSpendUsd).toBeGreaterThanOrEqual(550);
    expect(result.alertsFired).toBeGreaterThanOrEqual(1);
  });

  it("dedupes the same alert within the 1h cooldown window", async () => {
    if (!canRunIntegration) return;
    await seedStuckReservation({
      ws: workspaceId,
      credits: 5000,
      minutesAgo: 60,
      idempotencyKey: "stuck_dedupe__reserve",
    });

    const { runCreditAnomalyDetection } = await import("./creditAnomalyDetectorJob");
    const first = await runCreditAnomalyDetection();
    const second = await runCreditAnomalyDetection();
    expect(first.alertsFired).toBeGreaterThanOrEqual(1);
    // Second cycle finds the same anomaly but should suppress its alert.
    expect(second.alertsSuppressed).toBeGreaterThanOrEqual(1);
    expect(second.alertsFired).toBe(0);
  });
});
