import { readdir, readFile } from "fs/promises";
import path from "path";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "./postgres";

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

let migrationPromise: Promise<number> | null = null;

export async function applySqlMigrations(options?: {
  migrationsDir?: string;
  execute?: (sql: string) => Promise<unknown>;
  log?: (message: string) => void;
}): Promise<number> {
  const migrationsDir = options?.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const execute = options?.execute ?? ((sql: string) => queryPostgres(sql));
  const log = options?.log ?? console.log;
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, migrationFile), "utf8");
    log(`[postgres] Applying migration ${migrationFile}`);
    await execute(sql);
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
