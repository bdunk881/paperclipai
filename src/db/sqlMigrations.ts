import { readdir, readFile } from "fs/promises";
import path from "path";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "./postgres";

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

let migrationPromise: Promise<number> | null = null;

/**
 * Tracking table for which migration filenames have already been applied.
 * Lives in the same database it tracks. Created on first run.
 *
 * Previous behaviour ran every migration on every boot, which fails the moment
 * any non-idempotent DDL hits a schema that already has the target object —
 * exactly what bit Fly when migration 021_canonical_noun_rename.sql tried to
 * RENAME `provisioned_companies` → `companies` against a dev DB that already
 * had a hand-created `companies` table.
 */
const TRACKING_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS __sql_migrations (
    filename     text PRIMARY KEY,
    applied_at   timestamptz NOT NULL DEFAULT now()
  );
`;

/**
 * Tables whose presence indicates the schema is already at-or-past the
 * canonical-noun rename point (migration 021). When the tracking table is
 * empty AND any of these are present, seed the tracking table with migrations
 * 001–021 so the runner doesn't try to re-apply non-idempotent DDL against
 * the already-renamed schema.
 *
 * `companies` came from migration 021 (renamed from `provisioned_companies`).
 * `agents` came from the same migration (renamed from `control_plane_agents`).
 */
const POST_RENAME_INDICATORS = ["companies", "agents", "audit_log"];

/**
 * The highest filename prefix safe to auto-seed. Originally the auto-seed
 * marked EVERY migration file as applied — which falsely fast-forwarded
 * past 022+ on dev databases that had the post-rename schema but never ran
 * the canonical-product migrations. The result: `runs` / `missions` /
 * `step_results` / `approvals` / `activity_events` tables never existed on
 * dev despite the boot log claiming "All 47 migration file(s) already
 * applied". We cap the auto-seed at 021 (the rename migration itself); 022+
 * are post-rename canonical tables that must be allowed to run.
 */
const AUTO_SEED_PREFIX_CEILING = "022_";

/**
 * Canonical-schema tables introduced by migrations 022+. If any of these is
 * missing on boot AND its migration is marked applied in `__sql_migrations`,
 * the runner un-marks the affected migration so it re-applies on the next
 * boot. Pairs with the auto-seed cap above as belt-and-suspenders against
 * the over-seeding regression that bit dev.
 */
const CANONICAL_TABLE_TO_MIGRATION: ReadonlyArray<{ table: string; filenamePrefix: string }> = [
  { table: "missions", filenamePrefix: "022_" },
  { table: "hiring_plans", filenamePrefix: "022_" },
  { table: "workflows", filenamePrefix: "023_" },
  { table: "workflow_versions", filenamePrefix: "023_" },
  { table: "routines", filenamePrefix: "023_" },
  { table: "runs", filenamePrefix: "023_" },
  { table: "step_results", filenamePrefix: "023_" },
  { table: "approvals", filenamePrefix: "024_" },
  { table: "activity_events", filenamePrefix: "024_" },
  { table: "connector_connections", filenamePrefix: "025_" },
  { table: "budgets", filenamePrefix: "025_" },
  { table: "subscriptions", filenamePrefix: "025_" },
  { table: "entitlements", filenamePrefix: "025_" },
  { table: "agent_assignments", filenamePrefix: "031_" },
  { table: "org_edges", filenamePrefix: "031_" },
  { table: "wake_events", filenamePrefix: "035_" },
];

/**
 * Canonical columns added by ALTER TABLE migrations 022+. If a column is
 * missing on boot, repair fires — covers the case where the over-seeded
 * tracking table marked an ALTER TABLE migration as applied without ever
 * running it (e.g. 028 adds subscriptions.user_id, 032 adds
 * missions.metadata).
 */
const CANONICAL_COLUMN_TO_MIGRATION: ReadonlyArray<{
  table: string;
  column: string;
  filenamePrefix: string;
}> = [
  { table: "missions", column: "metadata", filenamePrefix: "032_" },
  { table: "subscriptions", column: "user_id", filenamePrefix: "028_" },
  { table: "subscriptions", column: "current_period_start", filenamePrefix: "028_" },
  { table: "workspace_members", column: "role", filenamePrefix: "026_" },
  { table: "workspaces", column: "tier_routing", filenamePrefix: "033_" },
  { table: "step_results", column: "idempotency_key", filenamePrefix: "040_" },
];

interface ExecutorOptions {
  migrationsDir?: string;
  execute?: (sql: string) => Promise<unknown>;
  log?: (message: string) => void;
  /**
   * Optional override for the tracking-table reader. Real Postgres goes
   * through `queryPostgres`; tests can substitute.
   */
  readApplied?: () => Promise<Set<string>>;
  /** Optional override for marking a migration applied. */
  markApplied?: (filename: string) => Promise<void>;
  /** Optional override for un-marking a migration applied (self-repair path). */
  removeApplied?: (filename: string) => Promise<void>;
  /** Optional override for table-existence probes (self-repair path). */
  tableExists?: (table: string) => Promise<boolean>;
  /** Optional override for column-existence probes (self-repair path). */
  columnExists?: (table: string, column: string) => Promise<boolean>;
  /** Optional override for the bootstrap "is this a post-rename DB?" probe. */
  detectPostRenameSchema?: () => Promise<boolean>;
}

export async function applySqlMigrations(options?: ExecutorOptions): Promise<number> {
  const migrationsDir = options?.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const execute = options?.execute ?? ((sql: string) => queryPostgres(sql));
  const log = options?.log ?? console.log;

  const readApplied =
    options?.readApplied ??
    (async () => {
      await queryPostgres(TRACKING_TABLE_DDL);
      const result = await queryPostgres<{ filename: string }>(
        "SELECT filename FROM __sql_migrations"
      );
      return new Set(result.rows.map((r) => r.filename));
    });

  const markApplied =
    options?.markApplied ??
    (async (filename: string) => {
      await queryPostgres(
        "INSERT INTO __sql_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [filename]
      );
    });

  const detectPostRenameSchema =
    options?.detectPostRenameSchema ??
    (async () => {
      const result = await queryPostgres<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
        ) AS exists`,
        [POST_RENAME_INDICATORS]
      );
      return result.rows[0]?.exists === true;
    });

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const applied = await readApplied();

  // Auto-seed for a pre-existing post-rename DB: if the tracking table is
  // empty but the canonical schema indicates migrations have already been
  // applied historically, mark migrations 001–021 as applied so the runner
  // doesn't try to re-apply non-idempotent renames. CRITICAL: we cap the
  // seed at AUTO_SEED_PREFIX_CEILING — over-seeding past 021 is the bug
  // that left `runs`/`missions`/`step_results`/etc. missing on dev despite
  // boot logs claiming everything was applied.
  if (applied.size === 0 && (await detectPostRenameSchema())) {
    const eligible = migrationFiles.filter((f) => f < AUTO_SEED_PREFIX_CEILING);
    log(
      `[postgres] Detected canonical schema (likely from prior manual setup); ` +
        `seeding __sql_migrations with ${eligible.length} pre-canonical files ` +
        `(001-021) to skip re-application. Migrations 022+ will run normally.`
    );
    for (const filename of eligible) {
      await markApplied(filename);
      applied.add(filename);
    }
  }

  // Self-repair: if a canonical-schema table from migration 022+ is missing
  // but its source migration is recorded as applied, un-mark the migration
  // so it re-applies. Catches the regression where the old over-seeding
  // logic falsely fast-forwarded the tracking table past 022.
  const removeApplied =
    options?.removeApplied ??
    (async (filename: string) => {
      await queryPostgres("DELETE FROM __sql_migrations WHERE filename = $1", [filename]);
    });
  const tableExists =
    options?.tableExists ??
    (async (table: string) => {
      const result = await queryPostgres<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) AS exists`,
        [table]
      );
      return result.rows[0]?.exists === true;
    });

  const columnExists =
    options?.columnExists ??
    (async (table: string, column: string) => {
      const result = await queryPostgres<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        ) AS exists`,
        [table, column]
      );
      return result.rows[0]?.exists === true;
    });

  // Pass 1: detect the over-seed bug by checking for any missing canonical
  // table OR column from migrations 022+. If we find ANY missing table or
  // column while its creating-migration is marked applied, we know auto-seed
  // ran the bad path.
  let detectedOverSeed = false;
  let overseedReason = "";
  for (const { table, filenamePrefix } of CANONICAL_TABLE_TO_MIGRATION) {
    const filename = migrationFiles.find((f) => f.startsWith(filenamePrefix));
    if (!filename || !applied.has(filename)) continue;
    if (await tableExists(table)) continue;
    detectedOverSeed = true;
    overseedReason = `canonical table "${table}" is missing (migration ${filename})`;
    break;
  }
  if (!detectedOverSeed) {
    for (const { table, column, filenamePrefix } of CANONICAL_COLUMN_TO_MIGRATION) {
      const filename = migrationFiles.find((f) => f.startsWith(filenamePrefix));
      if (!filename || !applied.has(filename)) continue;
      if (!(await tableExists(table))) continue;
      if (await columnExists(table, column)) continue;
      detectedOverSeed = true;
      overseedReason = `canonical column "${table}.${column}" is missing (migration ${filename})`;
      break;
    }
  }
  if (detectedOverSeed) {
    log(
      `[postgres] Repair: ${overseedReason}. Over-seed bug detected; ` +
        `un-marking ALL migrations >= ${AUTO_SEED_PREFIX_CEILING} so they re-apply.`
    );
  }

  // Pass 2: if over-seed was detected, un-mark every migration 022+. This
  // covers ALTER TABLE migrations (e.g. 028 subscription columns, 032 missions
  // metadata, 033 workspace tier routing) whose missing columns aren't visible
  // to a tableExists() probe. All affected migrations are idempotent (CREATE
  // TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE), so
  // re-applying them on a partially-applied schema is safe.
  if (detectedOverSeed) {
    for (const filename of migrationFiles) {
      if (filename < AUTO_SEED_PREFIX_CEILING) continue;
      if (!applied.has(filename)) continue;
      await removeApplied(filename);
      applied.delete(filename);
    }
  }

  let appliedCount = 0;
  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, migrationFile), "utf8");
    log(`[postgres] Applying migration ${migrationFile}`);
    await execute(sql);
    await markApplied(migrationFile);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    log(
      `[postgres] All ${migrationFiles.length} migration file(s) already applied (skipped on boot).`
    );
  } else {
    log(`[postgres] Applied ${appliedCount} new migration file(s).`);
  }

  return migrationFiles.length;
}

export async function ensureSqlMigrationsApplied(): Promise<number> {
  if (isPostgresConfigured()) {
    if (!migrationPromise) {
      migrationPromise = applySqlMigrations().catch((error) => {
        migrationPromise = null;
        throw error;
      });
    }

    return migrationPromise;
  }

  if (inMemoryAllowed()) {
    return 0;
  }

  throw new Error("SQL migrations require DATABASE_URL outside development/test.");
}

export function resetSqlMigrationStateForTests(): void {
  migrationPromise = null;
}
