import { readFileSync } from "fs";
import path from "path";

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

    expect(migration).toContain("DROP POLICY IF EXISTS tickets_tenant_isolation ON tickets;");
    expect(migration).toContain(
      "DROP POLICY IF EXISTS ticket_sla_policies_tenant_isolation ON ticket_sla_policies;"
    );
    expect(migration).toContain(
      "DROP POLICY IF EXISTS ticket_sla_snapshots_tenant_isolation ON ticket_sla_snapshots;"
    );
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

  describe("migration 017 control plane secrets (ALT-2022 Phase 3)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "017_control_plane_secrets.sql"),
      "utf8"
    );

    const tables = ["provisioned_company_secrets", "control_plane_secret_audit"];

    it.each(tables)("declares %s with workspace_id NOT NULL referencing workspaces", (table) => {
      const definitionPattern = new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?workspace_id uuid NOT NULL REFERENCES workspaces\\(id\\) ON DELETE CASCADE`,
        "m"
      );
      expect(migration).toMatch(definitionPattern);
    });

    it.each(tables)("declares %s with company_id NOT NULL referencing provisioned_companies", (table) => {
      const definitionPattern = new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?company_id uuid NOT NULL REFERENCES provisioned_companies\\(id\\) ON DELETE CASCADE`,
        "m"
      );
      expect(migration).toMatch(definitionPattern);
    });

    it.each(tables)("enables row-level security on %s", (table) => {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    });

    it.each(tables)("forces row-level security on %s so the table owner cannot bypass", (table) => {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
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

    it("enforces 12-byte IV and 16-byte auth tag length checks on provisioned_company_secrets", () => {
      expect(migration).toContain("CONSTRAINT provisioned_company_secrets_iv_length CHECK (octet_length(iv) = 12)");
      expect(migration).toContain(
        "CONSTRAINT provisioned_company_secrets_auth_tag_length CHECK (octet_length(auth_tag) = 16)"
      );
    });

    it("scopes provisioned_company_secrets uniqueness per (company_id, key)", () => {
      expect(migration).toContain("UNIQUE (company_id, key)");
    });

    it("makes the audit ledger append-only by denying UPDATE and DELETE inside RLS policies", () => {
      expect(migration).toContain("DROP POLICY IF EXISTS control_plane_secret_audit_no_update ON control_plane_secret_audit;");
      const noUpdatePolicy = /CREATE POLICY control_plane_secret_audit_no_update\s+ON control_plane_secret_audit\s+FOR UPDATE\s+USING \(false\)\s+WITH CHECK \(false\);/m;
      expect(migration).toMatch(noUpdatePolicy);
      expect(migration).toContain("DROP POLICY IF EXISTS control_plane_secret_audit_no_delete ON control_plane_secret_audit;");
      const noDeletePolicy = /CREATE POLICY control_plane_secret_audit_no_delete\s+ON control_plane_secret_audit\s+FOR DELETE\s+USING \(false\);/m;
      expect(migration).toMatch(noDeletePolicy);
    });

    it("constrains the audit action enum to read|write|rotate|delete", () => {
      expect(migration).toContain("CHECK (action IN ('read', 'write', 'rotate', 'delete'))");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 019 control plane execution state (ALT-2042 Phase 4)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "019_control_plane_execution_state.sql"),
      "utf8"
    );

    const tables = [
      "control_plane_tasks",
      "control_plane_heartbeats",
      "control_plane_spend_entries",
      "control_plane_budget_alerts",
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

    it.each(tables)("forces row-level security on %s so the table owner cannot bypass", (table) => {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
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

    it("constrains task status to the runtime enum", () => {
      expect(migration).toContain("CHECK (status IN ('todo', 'in_progress', 'done', 'blocked'))");
    });

    it("constrains heartbeat status to the runtime enum", () => {
      expect(migration).toContain("CHECK (status IN ('queued', 'running', 'blocked', 'completed'))");
    });

    it("constrains spend category to the runtime enum", () => {
      expect(migration).toContain(
        "CHECK (category IN ('llm', 'tool', 'api', 'compute', 'ad_spend', 'third_party'))"
      );
    });

    it("constrains budget-alert scope to team|agent|tool", () => {
      expect(migration).toContain("CHECK (scope IN ('team', 'agent', 'tool'))");
    });

    it("dedupes budget alerts per scope/threshold via partial unique indexes", () => {
      expect(migration).toContain("uq_control_plane_budget_alerts_team_scope");
      expect(migration).toContain("uq_control_plane_budget_alerts_agent_scope");
      expect(migration).toContain("uq_control_plane_budget_alerts_tool_scope");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });
});
