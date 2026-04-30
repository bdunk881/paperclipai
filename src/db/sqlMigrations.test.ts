import path from "path";
import { readFileSync } from "fs";

const mockReaddir = jest.fn();
const mockReadFile = jest.fn();
const mockIsPostgresConfigured = jest.fn();
const mockQueryPostgres = jest.fn();

jest.mock("fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock("./postgres", () => ({
  isPostgresConfigured: () => mockIsPostgresConfigured(),
  queryPostgres: (...args: unknown[]) => mockQueryPostgres(...args),
}));

import {
  applySqlMigrations,
  ensureSqlMigrationsApplied,
  resetSqlMigrationStateForTests,
} from "./sqlMigrations";

describe("sql migrations", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
    resetSqlMigrationStateForTests();
  });

  it("applies SQL files in lexical order and ignores non-SQL entries", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();

    mockReaddir.mockResolvedValue([
      { name: "010_ticket_sla_notifications.sql", isFile: () => true },
      { name: "002_workflow_runtime_persistence.sql", isFile: () => true },
      { name: "README.md", isFile: () => true },
      { name: "nested", isFile: () => false },
    ]);
    mockReadFile.mockImplementation(async (filePath: string) => `-- ${filePath}`);

    await expect(
      applySqlMigrations({
        migrationsDir: "/tmp/migrations",
        execute,
        log,
      })
    ).resolves.toBe(2);

    expect(mockReadFile.mock.calls.map(([filePath]) => filePath)).toEqual([
      "/tmp/migrations/002_workflow_runtime_persistence.sql",
      "/tmp/migrations/010_ticket_sla_notifications.sql",
    ]);
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      "-- /tmp/migrations/002_workflow_runtime_persistence.sql",
      "-- /tmp/migrations/010_ticket_sla_notifications.sql",
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "[postgres] Applying migration 002_workflow_runtime_persistence.sql",
      "[postgres] Applying migration 010_ticket_sla_notifications.sql",
    ]);
  });

  it("runs migrations only once per process when postgres is configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({ rows: [], rowCount: 0 });

    mockReaddir.mockResolvedValue([{ name: "001_autoflow_schema.sql", isFile: () => true }]);
    mockReadFile.mockResolvedValue("SELECT 1;");

    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);
    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);

    expect(mockReaddir).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
  });

  it("keeps the RLS hardening migration idempotent for policy recreation", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "014_rls_hardening.sql"),
      "utf8"
    );

    expect(migration).toContain("CREATE POLICY tickets_tenant_isolation");
    expect(migration).toContain("CREATE POLICY ticket_sla_policies_tenant_isolation");
    expect(migration).toContain("CREATE POLICY ticket_sla_snapshots_tenant_isolation");
  });

  describe("migration 015 control plane persistence (ALT-1984 Phase 2)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "015_control_plane_persistence.sql"),
      "utf8"
    );

    const tables = [
      "provisioned_companies",
      "control_plane_teams",
      "control_plane_agents",
      "control_plane_executions",
    ];

    it.each(tables)("declares %s with workspace_id NOT NULL referencing workspaces", (table) => {
      const definitionPattern = new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?workspace_id uuid NOT NULL REFERENCES workspaces\\(id\\) ON DELETE CASCADE`,
        "m"
      );
      expect(migration).toMatch(definitionPattern);
    });

    it.each(tables)("enables row-level security on %s", (table) => {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    });

    it.each(tables)("recreates the tenant-isolation policy on %s idempotently", (table) => {
      expect(migration).toContain(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table};`);
      expect(migration).toContain(`CREATE POLICY ${table}_tenant_isolation`);
    });

    it.each(tables)("uses NULL-denial RLS pattern on %s (USING and WITH CHECK both)", (table) => {
      const policyPattern = new RegExp(
        `CREATE POLICY ${table}_tenant_isolation\\s+ON ${table}\\s+USING \\(\\s*app_current_workspace_id\\(\\) IS NOT NULL\\s+AND workspace_id = app_current_workspace_id\\(\\)\\s*\\)\\s+WITH CHECK \\(\\s*app_current_workspace_id\\(\\) IS NOT NULL\\s+AND workspace_id = app_current_workspace_id\\(\\)\\s*\\);`,
        "m"
      );
      expect(migration).toMatch(policyPattern);
    });

    it("scopes the provisioned_companies idempotency UNIQUE per (workspace, user) — never globally", () => {
      expect(migration).toContain("UNIQUE (workspace_id, user_id, idempotency_key)");
      expect(migration).not.toMatch(/UNIQUE\s*\(\s*idempotency_key\s*\)/);
    });

    it("guards deferred FK adds with pg_constraint existence checks for re-runs", () => {
      expect(migration).toContain("conname = 'provisioned_companies_team_fk'");
      expect(migration).toContain("conname = 'control_plane_agents_current_execution_fk'");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });
});
