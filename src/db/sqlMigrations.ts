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
 * empty AND any of these are present, seed the tracking table with the full
 * known migration list so the runner doesn't try to re-apply non-idempotent
 * DDL against an already-migrated database.
 *
 * `companies` came from migration 021 (renamed from `provisioned_companies`).
 * `agents` came from the same migration (renamed from `control_plane_agents`).
 */
const POST_RENAME_INDICATORS = ["companies", "agents", "audit_log"];

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
  // applied historically, mark every known file as applied to skip them.
  if (applied.size === 0 && (await detectPostRenameSchema())) {
    log(
      `[postgres] Detected canonical schema (likely from prior manual setup); ` +
        `seeding __sql_migrations with ${migrationFiles.length} files to skip re-application.`
    );
    for (const filename of migrationFiles) {
      await markApplied(filename);
      applied.add(filename);
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
