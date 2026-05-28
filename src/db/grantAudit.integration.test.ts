/**
 * HEL-302 regression guard.
 *
 * Migration 089 revokes `SELECT` from the `anon` + `authenticated`
 * roles on every `public.*` table EXCEPT a small allowlist (today:
 * just `public_status_events`). This test runs against the live
 * Postgres connection in CI and fails loudly if a future migration
 * — or a manual `GRANT` in the Supabase Studio — re-grants SELECT
 * to either role.
 *
 * Mirrors the gating pattern from `rls.integration.test.ts`: skips
 * silently when `DATABASE_URL` isn't set so unit-test runs aren't
 * coupled to a local Postgres.
 */

import type { Pool } from "pg";

/**
 * Tables we INTENTIONALLY allow `anon` + `authenticated` to SELECT
 * from. Keep this list short and add a `// why:` comment per entry
 * so the audit trail is reviewable. If you find yourself extending
 * this allowlist, check whether the surface really needs PostgREST
 * exposure or whether a backend endpoint would do.
 */
const PUBLIC_SELECT_ALLOWLIST = new Set<string>([
  // why: feeds the unauthenticated public status page at /status.
  // Realtime subscriptions need the grant to broadcast component
  // status transitions; see `src/landing/publicStatusService.ts`.
  "public_status_events",
]);

describe("public.* anon/authenticated SELECT grant audit (HEL-302)", () => {
  const originalJestWorkerId = process.env.JEST_WORKER_ID;
  let canRunIntegration = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pg: any;
  let pgPool: Pool;

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
    if (!process.env.DATABASE_URL?.trim()) {
      canRunIntegration = false;
      return;
    }
    try {
      pg = await import("./postgres");
      const migrations = await import("./sqlMigrations");
      canRunIntegration = await pg.checkPostgresConnection();
      if (canRunIntegration) {
        await migrations.ensureSqlMigrationsApplied();
        pgPool = pg.getPostgresPool();
      }
    } catch (err) {
      console.error("[HEL-302 grant audit] beforeAll setup failed:", err);
      canRunIntegration = false;
    }
  }, 120_000);

  afterAll(async () => {
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
    if (pg) {
      await pg.closePostgresPoolForTests().catch(() => {
        /* swallow — best-effort teardown */
      });
    }
  }, 30_000);

  it("no public.* tables outside the allowlist grant SELECT to anon or authenticated", async () => {
    if (!canRunIntegration) {
      // Skip silently — unit-test runs don't have a Postgres available.
      // The CI integration job sets DATABASE_URL.
      return;
    }

    const result = await pgPool.query<{ table_name: string; grantee: string }>(
      `SELECT table_name, grantee
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND privilege_type = 'SELECT'
          AND grantee IN ('anon', 'authenticated')
        ORDER BY table_name, grantee`,
    );

    const offenders = result.rows.filter(
      (row) => !PUBLIC_SELECT_ALLOWLIST.has(row.table_name),
    );

    if (offenders.length > 0) {
      const grouped = new Map<string, string[]>();
      for (const { table_name, grantee } of offenders) {
        const existing = grouped.get(table_name) ?? [];
        existing.push(grantee);
        grouped.set(table_name, existing);
      }
      const summary = Array.from(grouped.entries())
        .map(([table, grantees]) => `  - ${table}: ${grantees.join(", ")}`)
        .join("\n");
      throw new Error(
        `HEL-302 regression: ${grouped.size} public.* table(s) still grant SELECT ` +
          `to anon/authenticated outside the allowlist. Add to ` +
          `PUBLIC_SELECT_ALLOWLIST in grantAudit.integration.test.ts with a ` +
          `"why:" comment if intentional, or extend migration 089 to revoke:\n${summary}`,
      );
    }
  }, 60_000);

  it("allowlist entries still exist as public.* tables (dead allowlist guard)", async () => {
    if (!canRunIntegration) return;

    const result = await pgPool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'`,
    );
    const present = new Set(result.rows.map((r) => r.table_name));
    const stale = Array.from(PUBLIC_SELECT_ALLOWLIST).filter((t) => !present.has(t));
    expect(stale).toEqual([]);
  }, 30_000);
});
