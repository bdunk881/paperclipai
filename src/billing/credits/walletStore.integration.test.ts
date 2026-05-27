/**
 * HEL-credits-mvp — Postgres integration tests for the wallet RPCs.
 *
 * Why this file exists: walletStore.test.ts runs against the in-memory
 * shim, which mirrors the SQL functions' intent but is a separate
 * implementation. Migration 068 + 075 (commit_credits over-spend
 * cap fix from the Codex P1 review) drift could go undetected if the
 * SQL function were the only place the bug lived. These tests exercise
 * the real Postgres functions directly so the SQL stays honest.
 *
 * Skipped automatically when DATABASE_URL is absent (local dev without
 * a Postgres container). The CI `Test API Integration (TypeScript +
 * Postgres)` job sets DATABASE_URL via a pgvector/pg16 service.
 *
 * Cleanup convention follows subscriptionStore.integration.test.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("credit wallet RPCs — Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;

  const userId = "credits-integration-user";
  const workspaceId = "61616161-6161-4161-8161-616161616161";

  let canRunIntegration = false;
  let pg: any;

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
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
      console.error("[credits-integration] beforeAll setup failed:", err);
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
        console.error("[credits-integration] pool close failed:", err);
      });
    }
  }, 30_000);

  beforeEach(async () => {
    if (!canRunIntegration) return;
    // Per-test seed: user_profile + workspace fresh each time so we can
    // assert exact balances without worrying about cross-test bleed.
    await pg.queryPostgres(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, "Credits Integration User"],
    );
    await pg.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [workspaceId, "Credits Integration Workspace", userId],
    );
  });

  afterEach(async () => {
    if (!canRunIntegration) return;
    await pg.queryPostgres(
      `DELETE FROM workspace_credit_ledger WHERE workspace_id = $1`,
      [workspaceId],
    );
    await pg.queryPostgres(
      `DELETE FROM workspace_credit_wallets WHERE workspace_id = $1`,
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

  async function grant(credits: number, key: string): Promise<void> {
    // grant_credits(workspace_id, credits, grant_type, idempotency_key,
    //               related_kind, related_id, metadata) — 7 params.
    await pg.queryPostgres(
      `SELECT * FROM grant_credits($1::uuid, $2::bigint, 'purchase'::text, $3::text, NULL, NULL, NULL)`,
      [workspaceId, credits.toString(), key],
    );
  }

  async function reserve(credits: number, key: string): Promise<void> {
    // reserve_credits(workspace_id, credits, idempotency_key,
    //                 provider, model, metadata) — 6 params. No userId arg.
    await pg.queryPostgres(
      `SELECT * FROM reserve_credits($1::uuid, $2::bigint, $3::text, $4::text, $5::text, NULL)`,
      [workspaceId, credits.toString(), key, "anthropic", "claude-sonnet-4-6"],
    );
  }

  async function commit(args: {
    reservationKey: string;
    commitKey: string;
    actualCredits: number;
  }): Promise<{ committed: boolean; balanceAfter: bigint | null; reason: string }> {
    const res = await pg.queryPostgres(
      `SELECT committed, balance_after, reason
         FROM commit_credits(
           $1::uuid, $2::text, $3::text, $4::bigint,
           'anthropic'::text, 'claude-sonnet-4-6'::text,
           100::integer, 50::integer, 0::integer,
           0.001::numeric, 0.0015::numeric, 1.5::numeric,
           NULL, NULL, NULL
         )`,
      [workspaceId, args.reservationKey, args.commitKey, args.actualCredits.toString()],
    );
    const row = res.rows[0] as { committed: boolean; balance_after: string | null; reason: string };
    return {
      committed: row.committed,
      balanceAfter: row.balance_after == null ? null : BigInt(row.balance_after),
      reason: row.reason,
    };
  }

  async function getBalance(): Promise<bigint> {
    const res = await pg.queryPostgres(
      `SELECT balance_credits::text AS balance_credits
         FROM workspace_credit_wallets
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    return res.rowCount === 0 ? 0n : BigInt((res.rows[0] as { balance_credits: string }).balance_credits);
  }

  it("commits exactly the reserved credits when the LLM matches the estimate", async () => {
    if (!canRunIntegration) return;
    await grant(1000, "grant-1");
    await reserve(500, "reserve-1");
    expect(await getBalance()).toBe(500n);

    const result = await commit({
      reservationKey: "reserve-1",
      commitKey: "commit-1",
      actualCredits: 500,
    });

    expect(result.committed).toBe(true);
    expect(result.balanceAfter).toBe(500n);
  });

  it("refunds unused credits when the LLM uses less than reserved", async () => {
    if (!canRunIntegration) return;
    await grant(1000, "grant-2");
    await reserve(500, "reserve-2");
    expect(await getBalance()).toBe(500n);

    const result = await commit({
      reservationKey: "reserve-2",
      commitKey: "commit-2",
      actualCredits: 300,
    });

    // Used 300, reserved 500 — refund 200 back into balance.
    expect(result.committed).toBe(true);
    expect(result.balanceAfter).toBe(700n);
  });

  // CODEX P1 #2 — over-spend MUST NOT push the wallet below zero.
  it("clamps over-spend at the available balance (Codex P1 #2)", async () => {
    if (!canRunIntegration) return;
    await grant(1500, "grant-3");
    await reserve(1000, "reserve-3");
    // After reserve: wallet has 500 spare.
    expect(await getBalance()).toBe(500n);

    // LLM used 2000 — that's reserved 1000 + 1000 over the estimate.
    // Wallet has 500 spare; the extra 500 over-spend has nowhere to
    // come from. Before the migration-075 fix, this UPDATE violated
    // `CHECK (balance_credits >= 0)` and the COMMIT failed entirely.
    // After the fix: balance lands at 0, consumed shows 1500.
    const result = await commit({
      reservationKey: "reserve-3",
      commitKey: "commit-3",
      actualCredits: 2000,
    });

    expect(result.committed).toBe(true);
    expect(result.balanceAfter).toBe(0n);

    const consumed = await pg.queryPostgres(
      `SELECT lifetime_consumed_credits::text AS consumed
         FROM workspace_credit_wallets
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect((consumed.rows[0] as { consumed: string }).consumed).toBe("1500");
  });

  it("refunds full unused reservation even when wallet was drained by the reserve", async () => {
    if (!canRunIntegration) return;
    await grant(1000, "grant-4");
    await reserve(1000, "reserve-4");
    expect(await getBalance()).toBe(0n);

    // LLM used only 600 of the 1000 reserved. Wallet is currently 0
    // because the reserve drained it. The original GREATEST(...) formula
    // returned `GREATEST(-400, 0) = 0` here, dropping the refund silently.
    // The migration-075 fix uses LEAST(-400, 0) = -400, so balance ends
    // at 400 (the full refund of the unused portion).
    const result = await commit({
      reservationKey: "reserve-4",
      commitKey: "commit-4",
      actualCredits: 600,
    });

    expect(result.committed).toBe(true);
    expect(result.balanceAfter).toBe(400n);
  });

  it("is idempotent on retried commit calls", async () => {
    if (!canRunIntegration) return;
    await grant(1000, "grant-5");
    await reserve(400, "reserve-5");

    const first = await commit({
      reservationKey: "reserve-5",
      commitKey: "commit-5",
      actualCredits: 400,
    });
    const second = await commit({
      reservationKey: "reserve-5",
      commitKey: "commit-5",
      actualCredits: 400,
    });

    expect(first.committed).toBe(true);
    expect(first.reason).toBe("committed");
    expect(second.committed).toBe(true);
    expect(second.reason).toBe("duplicate");
    expect(await getBalance()).toBe(600n);
  });

  it("rejects a commit with no matching reservation", async () => {
    if (!canRunIntegration) return;
    await grant(1000, "grant-6");

    const result = await commit({
      reservationKey: "reserve-does-not-exist",
      commitKey: "commit-6",
      actualCredits: 100,
    });

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("no_reservation");
  });
});
