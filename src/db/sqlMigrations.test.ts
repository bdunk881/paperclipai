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
    const appliedNames = new Set<string>();

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
        readApplied: async () => new Set(appliedNames),
        markApplied: async (name) => {
          appliedNames.add(name);
        },
        detectPostRenameSchema: async () => false,
      })
    ).resolves.toBe(2);

    // path.join uses platform-native separators; assert by checking the
    // filename suffix rather than the full path string.
    expect(mockReadFile.mock.calls.map(([filePath]) => path.basename(filePath))).toEqual([
      "002_workflow_runtime_persistence.sql",
      "010_ticket_sla_notifications.sql",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        "[postgres] Applying migration 002_workflow_runtime_persistence.sql",
        "[postgres] Applying migration 010_ticket_sla_notifications.sql",
      ])
    );
    expect(appliedNames).toEqual(
      new Set([
        "002_workflow_runtime_persistence.sql",
        "010_ticket_sla_notifications.sql",
      ])
    );
  });

  it("skips already-applied migrations on subsequent runs (HEL-83 unblock)", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const appliedNames = new Set<string>(["001_a.sql"]);

    mockReaddir.mockResolvedValue([
      { name: "001_a.sql", isFile: () => true },
      { name: "002_b.sql", isFile: () => true },
    ]);
    mockReadFile.mockResolvedValue("SELECT 1;");

    await expect(
      applySqlMigrations({
        migrationsDir: "/tmp/migrations",
        execute,
        log,
        readApplied: async () => new Set(appliedNames),
        markApplied: async (name) => {
          appliedNames.add(name);
        },
        detectPostRenameSchema: async () => false,
      })
    ).resolves.toBe(2);

    // Only 002_b.sql ran; 001 was already in the tracking table.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe("SELECT 1;");
    expect(appliedNames).toEqual(new Set(["001_a.sql", "002_b.sql"]));
  });

  it("auto-seeds the tracking table when canonical schema is present and tracker is empty (HEL-83 unblock)", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const seeded = new Set<string>();

    mockReaddir.mockResolvedValue([
      { name: "001_a.sql", isFile: () => true },
      { name: "002_b.sql", isFile: () => true },
      { name: "021_canonical_noun_rename.sql", isFile: () => true },
    ]);
    mockReadFile.mockResolvedValue("RENAME stuff;");

    await expect(
      applySqlMigrations({
        migrationsDir: "/tmp/migrations",
        execute,
        log,
        readApplied: async () => new Set(),
        markApplied: async (name) => {
          seeded.add(name);
        },
        detectPostRenameSchema: async () => true,
        tableExists: async () => true,
      })
    ).resolves.toBe(3);

    // Nothing executed — auto-seed marked all 001–021 migrations as applied
    // without running them. This unblocks a dev DB that already has the
    // canonical noun schema from prior manual setup.
    expect(execute).not.toHaveBeenCalled();
    expect(seeded).toEqual(
      new Set(["001_a.sql", "002_b.sql", "021_canonical_noun_rename.sql"])
    );
    expect(log.mock.calls.map(([m]) => m)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Detected canonical schema"),
      ])
    );
  });

  it("auto-seed runs (not bypasses) migrations 022+ (regression guard for the over-seed bug)", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const seedingOrder: string[] = [];
    const executingOrder: string[] = [];

    mockReaddir.mockResolvedValue([
      { name: "001_a.sql", isFile: () => true },
      { name: "021_canonical_noun_rename.sql", isFile: () => true },
      { name: "022_companies_missions_hiring_plans.sql", isFile: () => true },
      { name: "023_canonical_workflow_runtime.sql", isFile: () => true },
      { name: "035_wake_events.sql", isFile: () => true },
    ]);
    mockReadFile.mockImplementation(async (filePath: string) => `-- ${filePath}`);
    execute.mockImplementation(async (sql: string) => {
      executingOrder.push(sql);
    });

    await applySqlMigrations({
      migrationsDir: "/tmp/migrations",
      execute,
      log,
      readApplied: async () => new Set(),
      markApplied: async (name) => {
        seedingOrder.push(name);
      },
      detectPostRenameSchema: async () => true,
      tableExists: async () => false,
    });

    // 001 + 021 were auto-seeded as applied without executing.
    expect(executingOrder.some((sql) => sql.includes("001_a.sql"))).toBe(false);
    expect(executingOrder.some((sql) => sql.includes("021_canonical_noun_rename.sql"))).toBe(
      false,
    );
    // But 022+ DID execute (because the auto-seed cap leaves them out).
    expect(executingOrder.some((sql) => sql.includes("022_companies_missions_hiring_plans.sql"))).toBe(
      true,
    );
    expect(executingOrder.some((sql) => sql.includes("023_canonical_workflow_runtime.sql"))).toBe(
      true,
    );
    expect(executingOrder.some((sql) => sql.includes("035_wake_events.sql"))).toBe(true);
    // The cap log message is present.
    expect(log.mock.calls.map(([m]) => String(m))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Migrations 022+ will run normally"),
      ]),
    );
  });

  it("self-repair: triggers blanket repair when a canonical COLUMN (not table) is missing", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const applied = new Set([
      "001_a.sql",
      "022_companies_missions_hiring_plans.sql",
      "028_subscription_store_columns.sql",
      "032_missions_metadata.sql",
    ]);
    const removed: string[] = [];

    mockReaddir.mockResolvedValue([
      { name: "001_a.sql", isFile: () => true },
      { name: "022_companies_missions_hiring_plans.sql", isFile: () => true },
      { name: "028_subscription_store_columns.sql", isFile: () => true },
      { name: "032_missions_metadata.sql", isFile: () => true },
    ]);
    mockReadFile.mockResolvedValue("-- migration body");

    await applySqlMigrations({
      migrationsDir: "/tmp/migrations",
      execute,
      log,
      readApplied: async () => applied,
      markApplied: async () => {},
      removeApplied: async (name) => {
        removed.push(name);
        applied.delete(name);
      },
      // All canonical TABLES exist (the over-seed bug let 023/024/025 run on
      // a prior repair pass). But the missions.metadata COLUMN is missing
      // because migration 032 (ALTER TABLE) was over-seeded and never ran.
      tableExists: async () => true,
      columnExists: async (table, column) => {
        if (table === "missions" && column === "metadata") return false;
        return true;
      },
      detectPostRenameSchema: async () => false,
    });

    // Blanket repair fires — even though tables are fine, the missing
    // column triggers un-marking ALL 022+ migrations.
    expect(removed).toEqual(
      expect.arrayContaining([
        "022_companies_missions_hiring_plans.sql",
        "028_subscription_store_columns.sql",
        "032_missions_metadata.sql",
      ]),
    );
    const logs = log.mock.calls.map(([m]) => String(m));
    expect(logs.some((m) => m.includes('canonical column "missions.metadata" is missing'))).toBe(
      true,
    );
  });

  it("self-repair: un-marks ALL 022+ migrations when over-seed bug detected (covers ALTER TABLE migrations too)", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const applied = new Set([
      "001_a.sql",
      "021_canonical_noun_rename.sql",
      "022_companies_missions_hiring_plans.sql",
      "023_canonical_workflow_runtime.sql",
      "026_workspace_member_roles.sql",
      "028_subscription_store_columns.sql",
      "032_missions_metadata.sql",
      "034_three_layer_memory.sql",
    ]);
    const removed: string[] = [];
    const marked: string[] = [];

    mockReaddir.mockResolvedValue([
      { name: "001_a.sql", isFile: () => true },
      { name: "021_canonical_noun_rename.sql", isFile: () => true },
      { name: "022_companies_missions_hiring_plans.sql", isFile: () => true },
      { name: "023_canonical_workflow_runtime.sql", isFile: () => true },
      { name: "026_workspace_member_roles.sql", isFile: () => true },
      { name: "028_subscription_store_columns.sql", isFile: () => true },
      { name: "032_missions_metadata.sql", isFile: () => true },
      { name: "034_three_layer_memory.sql", isFile: () => true },
    ]);
    mockReadFile.mockResolvedValue("-- migration body");

    await applySqlMigrations({
      migrationsDir: "/tmp/migrations",
      execute,
      log,
      readApplied: async () => applied,
      markApplied: async (name) => {
        marked.push(name);
      },
      removeApplied: async (name) => {
        removed.push(name);
        applied.delete(name);
      },
      tableExists: async (table) => {
        // Simulate the dev-bug state: missions table is missing. ONE missing
        // table is enough to trigger blanket repair of ALL 022+ migrations.
        if (table === "missions") return false;
        return true;
      },
      detectPostRenameSchema: async () => false,
    });

    // Even though only `missions` is missing, repair un-marks ALL 022+
    // migrations because the ALTER TABLE / column-add migrations (028, 032)
    // aren't visible to a tableExists() probe.
    expect(removed).toEqual(
      expect.arrayContaining([
        "022_companies_missions_hiring_plans.sql",
        "023_canonical_workflow_runtime.sql",
        "026_workspace_member_roles.sql",
        "028_subscription_store_columns.sql",
        "032_missions_metadata.sql",
        "034_three_layer_memory.sql",
      ]),
    );
    // 001 and 021 stay applied.
    expect(removed).not.toContain("001_a.sql");
    expect(removed).not.toContain("021_canonical_noun_rename.sql");

    // Repair log message present (mentions un-marking ALL).
    const logs = log.mock.calls.map(([m]) => String(m));
    expect(logs.some((m) => m.includes("Over-seed bug detected"))).toBe(true);
    expect(logs.some((m) => m.includes("un-marking ALL"))).toBe(true);

    // And they all get re-applied.
    expect(marked).toContain("022_companies_missions_hiring_plans.sql");
    expect(marked).toContain("026_workspace_member_roles.sql");
    expect(marked).toContain("032_missions_metadata.sql");
  });

  it("runs migrations only once per process when postgres is configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    // Defaults call queryPostgres four times per migration cycle:
    //   1. CREATE TABLE IF NOT EXISTS __sql_migrations (tracking-table DDL)
    //   2. SELECT filename FROM __sql_migrations (read applied set)
    //   3. SELECT EXISTS (...) (detect post-rename schema)
    //   4. The migration body
    //   5. INSERT INTO __sql_migrations (mark applied)
    // Mock all with a generic empty result so the code paths return.
    mockQueryPostgres.mockResolvedValue({ rows: [], rowCount: 0 });

    mockReaddir.mockResolvedValue([{ name: "001_autoflow_schema.sql", isFile: () => true }]);
    mockReadFile.mockResolvedValue("SELECT 1;");

    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);
    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);

    expect(mockReaddir).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
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

  describe("migration 031 agent_assignments + org_edges (HEL-14)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "031_agent_assignments_org_edges.sql"),
      "utf8"
    );

    it("adds company_id FK on agents (nullable, ON DELETE SET NULL)", () => {
      expect(migration).toContain(
        "ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL"
      );
    });

    it("creates agent_assignments with UNIQUE (agent_id, routine_id)", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS agent_assignments");
      expect(migration).toContain("UNIQUE (agent_id, routine_id)");
    });

    it("creates org_edges with no-self-loop CHECK + manager+agent UNIQUE", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS org_edges");
      expect(migration).toContain("UNIQUE (manager_agent_id, agent_id)");
      expect(migration).toContain(
        "CONSTRAINT org_edges_no_self_loop CHECK (manager_agent_id <> agent_id)"
      );
    });

    it("installs the cycle-prevention BEFORE INSERT/UPDATE trigger", () => {
      expect(migration).toContain("CREATE OR REPLACE FUNCTION org_edges_assert_no_cycle");
      expect(migration).toContain("RAISE EXCEPTION 'org_edges cycle detected");
      expect(migration).toContain(
        "CREATE TRIGGER org_edges_no_cycle\n  BEFORE INSERT OR UPDATE ON org_edges"
      );
    });

    it.each(["agent_assignments", "org_edges"])(
      "ENABLE + FORCE row level security on %s with tenant isolation policy",
      (table) => {
        expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        expect(migration).toContain(`CREATE POLICY ${table}_tenant_isolation`);
      }
    );

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 030 lookup_team_workspace_id (HEL-66)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "030_lookup_team_workspace_id.sql"),
      "utf8"
    );

    it("declares lookup_team_workspace_id as a SECURITY DEFINER function", () => {
      expect(migration).toContain("CREATE OR REPLACE FUNCTION lookup_team_workspace_id(p_team_id uuid)");
      expect(migration).toContain("SECURITY DEFINER");
    });

    it("returns the workspace_id from agent_teams (single row)", () => {
      expect(migration).toMatch(/SELECT workspace_id FROM agent_teams WHERE id = p_team_id LIMIT 1/);
    });

    it("locks search_path to defend against schema-shadowing attacks on SECURITY DEFINER", () => {
      expect(migration).toContain(
        "ALTER FUNCTION lookup_team_workspace_id(uuid) SET search_path = public, pg_catalog"
      );
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 029 stripe_webhook_events (HEL-67)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "029_stripe_webhook_events.sql"),
      "utf8"
    );

    it("creates the stripe_webhook_events table keyed on event_id", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS stripe_webhook_events");
      expect(migration).toContain("event_id text PRIMARY KEY");
    });

    it.each(["event_type", "event_created", "resource_id", "processed_at"])(
      "declares the %s column for ordering / dedupe",
      (col) => {
        expect(migration).toContain(col);
      }
    );

    it("indexes (resource_id, event_created DESC) for ordering checks", () => {
      expect(migration).toContain(
        "CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_resource"
      );
      expect(migration).toContain("(resource_id, event_created DESC)");
      expect(migration).toContain("WHERE resource_id IS NOT NULL");
    });

    it("indexes processed_at DESC for ops dashboards", () => {
      expect(migration).toContain(
        "CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at"
      );
    });

    it("wraps schema changes in a single transaction", () => {
      expect(migration).toContain("BEGIN;");
      expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    });
  });

  describe("migration 028 subscription_store_columns (HEL-45)", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "..", "..", "migrations", "028_subscription_store_columns.sql"),
      "utf8"
    );

    it.each([
      "user_id",
      "email",
      "current_period_start",
      "trial_end",
      "access_level",
    ])("adds %s column for subscriptionStore round-trip parity", (col) => {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    });

    it("adds cancel_at_period_end with NOT NULL DEFAULT false", () => {
      expect(migration).toContain(
        "ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false"
      );
    });

    it("constrains access_level to the in-memory store enum", () => {
      expect(migration).toContain(
        "CHECK (access_level IS NULL OR access_level IN ('trial', 'active', 'past_due', 'cancelled', 'none'))"
      );
    });

    it("adds a partial index on user_id for getByUserId lookups", () => {
      expect(migration).toContain(
        "CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id"
      );
      expect(migration).toContain("WHERE user_id IS NOT NULL");
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
