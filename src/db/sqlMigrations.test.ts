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
  inMemoryAllowed: () => true,
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

  describe("migration 016 agent memory workspace isolation (ALT-2360)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "016_agent_memory_workspace_isolation.sql"),
      "utf8"
    );

    it("restores missing scope columns for committed schema parity", () => {
      expect(migration).toContain("ALTER TABLE agent_memory_entries");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'private'");
      expect(migration).toContain("ALTER TABLE agent_memory_kg_facts");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'private'");
    });

    it("enforces team_id for team-layer rows across memory tables and events", () => {
      expect(migration).toContain("agent_memory_entries_team_layer_check");
      expect(migration).toContain("agent_memory_kg_facts_team_layer_check");
      expect(migration).toContain("agent_heartbeat_logs_team_layer_check");
      expect(migration).toContain("agent_memory_events_team_layer_check");
      expect(migration).toContain("(memory_layer = 'team' AND team_id IS NOT NULL)");
    });

    it("creates an explicit opt-in policy table for cross-workspace sharing", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS agent_memory_sharing_policies");
      expect(migration).toContain("cross_workspace_enabled boolean NOT NULL DEFAULT false");
      expect(migration).toContain("require_shared_scope boolean NOT NULL DEFAULT true");
      expect(migration).toContain("allow_heartbeat_logs boolean NOT NULL DEFAULT false");
    });

    it("creates an allowlist share table that denies source=target and empty grants", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS agent_memory_workspace_shares");
      expect(migration).toContain("CHECK (source_workspace_id <> target_workspace_id)");
      expect(migration).toContain("CHECK (share_entries OR share_knowledge_facts OR share_heartbeat_logs)");
      expect(migration).toContain("WHERE revoked_at IS NULL");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 022 companies/missions/hiring_plans (HEL-13)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "022_companies_missions_hiring_plans.sql"),
      "utf8"
    );
    const seed = readFileSync(
      path.resolve(__dirname, "..", "..", "test", "fixtures", "hel_13_companies_missions_hiring_plans_seed.sql"),
      "utf8"
    );

    it("creates the canonical product-noun tables and fields", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS companies");
      expect(migration).toContain("workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS description text");
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS missions");
      expect(migration).toContain("company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE");
      expect(migration).toContain("created_by_user_id text NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT");
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS hiring_plans");
      expect(migration).toContain("mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE");
      expect(migration).toContain("accepted_by_user_id text REFERENCES user_profiles(user_id) ON DELETE SET NULL");
    });

    it("relaxes legacy company provisioning columns so canonical company rows can be seeded", () => {
      for (const column of [
        "user_id",
        "provisioned_workspace_name",
        "provisioned_workspace_slug",
        "team_id",
        "idempotency_key",
      ]) {
        expect(migration).toContain(`AND column_name = '${column}'`);
        expect(migration).toContain(`ALTER TABLE companies ALTER COLUMN ${column} DROP NOT NULL;`);
      }
    });

    it.each(["companies", "missions", "hiring_plans"])(
      "enables and forces row-level security on %s",
      (table) => {
        expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
        expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      }
    );

    it("uses direct workspace RLS for companies and parent-scoped RLS for child tables", () => {
      const companiesPolicy = /CREATE POLICY companies_tenant_isolation\s+ON companies\s+USING \(\s*app_current_workspace_id\(\) IS NOT NULL\s+AND workspace_id = app_current_workspace_id\(\)\s*\)\s+WITH CHECK \(\s*app_current_workspace_id\(\) IS NOT NULL\s+AND workspace_id = app_current_workspace_id\(\)\s*\);/m;
      expect(migration).toMatch(companiesPolicy);
      expect(migration).toContain("CREATE POLICY missions_tenant_isolation");
      expect(migration).toContain("WHERE companies.id = missions.company_id");
      expect(migration).toContain("CREATE POLICY hiring_plans_tenant_isolation");
      expect(migration).toContain("WHERE missions.id = hiring_plans.mission_id");
    });

    it("ships a reusable sample seed for tests", () => {
      expect(seed).toContain("SELECT set_config('app.current_workspace_id'");
      expect(seed).toContain("SELECT set_config('app.current_user_id'");
      expect(seed).toContain("INSERT INTO companies (id, workspace_id, name, description)");
      expect(seed).toContain("INSERT INTO missions (id, company_id, statement, status, created_by_user_id)");
      expect(seed).toContain("INSERT INTO hiring_plans (id, mission_id, draft)");
      expect(seed).toContain("ON CONFLICT (id) DO NOTHING");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 023 canonical workflow runtime (HEL-15)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "023_canonical_workflow_runtime.sql"),
      "utf8"
    );

    it("declares canonical workflow runtime tables", () => {
      for (const table of ["routines", "workflows", "workflow_versions", "runs", "step_results"]) {
        expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      }
    });

    it("makes runs reference the exact workflow version they executed", () => {
      expect(migration).toContain("workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT");
      expect(migration).toContain("FROM workflow_versions v");
    });

    it("migrates and removes legacy workflow runtime tables", () => {
      expect(migration).toContain("workflow_imported_templates -> workflows + workflow_versions");
      expect(migration).toContain("workflow_runs               -> runs");
      expect(migration).toContain("workflow_step_results        -> step_results");
      expect(migration).toContain("DROP TABLE IF EXISTS workflow_queue_jobs");
      expect(migration).toContain("DROP TABLE IF EXISTS workflow_step_results");
      expect(migration).toContain("DROP TABLE IF EXISTS workflow_runs");
      expect(migration).toContain("DROP TABLE IF EXISTS workflow_imported_templates");
    });

    it("keeps workflow edits reproducible by inserting immutable DAG versions", () => {
      expect(migration).toContain("dag jsonb NOT NULL");
      expect(migration).toContain("UNIQUE (workflow_id, version)");
      expect(migration).toContain("latest_version_id uuid");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 025 canonical remaining entities (HEL-17)", () => {
    // Renumbered from 022 → 025 during rebase: HEL-13 owns 022, HEL-15 owns
    // 023, HEL-16 owns 024. HEL-17 stacks on top.
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "025_canonical_remaining_entities.sql"),
      "utf8"
    );

    const tables = ["connector_connections", "budgets", "subscriptions", "entitlements"];

    it.each(tables)("declares %s with workspace-scoped tenant ownership", (table) => {
      const definitionPattern = new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?workspace_id uuid (?:PRIMARY KEY )?(?:NOT NULL )?REFERENCES workspaces\\(id\\) ON DELETE CASCADE`,
        "m"
      );
      expect(migration).toMatch(definitionPattern);
    });

    it.each(tables)("enables and forces row-level security on %s", (table) => {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    });

    it("adds canonical BYOK columns to llm_credentials without dropping legacy columns", () => {
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS key_ref text");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS validated_at timestamptz");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'");
    });

    it("creates indexed O(1) budget gate functions over budgets.used_cents", () => {
      expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_workspace_scope_period");
      expect(migration).toContain("CREATE OR REPLACE FUNCTION check_budget");
      expect(migration).toContain("CREATE OR REPLACE FUNCTION reserve_budget_cents");
      expect(migration).toContain("used_cents + p_delta_cents <= cap_cents");
    });

    it("adds canonical audit aliases and new privileged mutation categories", () => {
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS target_kind text");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS payload jsonb");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS occurred_at timestamptz");
      expect(migration).toContain("'billing'");
      expect(migration).toContain("'entitlement'");
      expect(migration).toContain("'budget'");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 027 RLS audit close gaps (HEL-20)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "027_rls_audit_close_gaps.sql"),
      "utf8"
    );

    it.each(["workflows", "workflow_versions", "routines", "runs", "step_results"])(
      "FORCEs row level security on %s (closes the table-owner-bypass gap)",
      (table) => {
        // Tolerate any whitespace between table name and FORCE so the
        // visually-aligned migration source isn't brittle on column count.
        const pattern = new RegExp(`ALTER TABLE ${table}\\s+FORCE ROW LEVEL SECURITY;`);
        expect(migration).toMatch(pattern);
      }
    );

    it("adds workspace-scoped tenant isolation on approvals (joins through runs)", () => {
      expect(migration).toContain(
        "DROP POLICY IF EXISTS approvals_workspace_tenant_isolation ON approvals"
      );
      expect(migration).toContain("CREATE POLICY approvals_workspace_tenant_isolation");
      expect(migration).toContain("FROM runs");
      expect(migration).toContain("runs.id = approvals.run_id");
      expect(migration).toContain("runs.workspace_id = app_current_workspace_id()");
    });

    it("uses both USING and WITH CHECK on the new approvals policy (read + write gated)", () => {
      const policy = /CREATE POLICY approvals_workspace_tenant_isolation[\s\S]*?USING \([\s\S]*?\)[\s\S]*?WITH CHECK \([\s\S]*?\);/m;
      expect(migration).toMatch(policy);
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 026 workspace_member_roles (HEL-19)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "026_workspace_member_roles.sql"),
      "utf8"
    );

    it("expands workspace_members.role to the canonical six roles plus member", () => {
      expect(migration).toContain(
        "CHECK (role IN ('owner', 'admin', 'billing', 'operator', 'developer', 'approver', 'member'))"
      );
    });

    it("drops both the legacy and the new constraint name idempotently before re-adding", () => {
      expect(migration).toContain("conname = 'workspace_members_role_check'");
      expect(migration).toContain("conname = 'workspace_members_role_canonical_check'");
      expect(migration).toContain("DROP CONSTRAINT workspace_members_role_check");
      expect(migration).toContain("DROP CONSTRAINT workspace_members_role_canonical_check");
    });

    it("adds an index supporting workspace+role lookups", () => {
      expect(migration).toContain(
        "CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_role"
      );
      expect(migration).toContain("ON workspace_members (workspace_id, role)");
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });
});
