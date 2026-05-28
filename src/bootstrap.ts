import {
  checkPostgresConnection,
  getRuntimeEnvironment,
  inMemoryAllowed,
  isPostgresConfigured,
} from "./db/postgres";
import { ensureSqlMigrationsApplied } from "./db/sqlMigrations";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";
import { assertProductionSafety } from "./security/qaBypassGuard";

type Logger = Pick<typeof console, "log" | "warn" | "error">;

export { inMemoryAllowed };

export const PERSISTENCE_REQUIRED_ERROR =
  "DATABASE_URL is required for AutoFlow persistence outside development/test. " +
  "Set DATABASE_URL before starting the server, or run with NODE_ENV=development/test " +
  "and AUTOFLOW_ALLOW_INMEMORY=true for process-local storage.";

export const POSTGRES_UNREACHABLE_PRODUCTION_ERROR =
  "[postgres] Database is configured but unreachable. In production this is a fatal " +
  "startup error — refusing to serve traffic against a broken persistence layer. " +
  "Verify DATABASE_URL points at a reachable Postgres and the credentials are valid, " +
  "then restart.";

export function requirePersistence(): void {
  if (isPostgresConfigured() || inMemoryAllowed()) {
    return;
  }

  throw new Error(PERSISTENCE_REQUIRED_ERROR);
}

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return getRuntimeEnvironment(env) === "production";
}

export async function initializePersistence(logger: Logger = console): Promise<void> {
  // HEL-258 / SEC-07 — fail loudly at boot if production has QA bypass
  // flags set. Runs before any DB connection so a misconfigured deploy
  // exits with a clear error instead of accepting traffic with bypasses
  // silently active.
  assertProductionSafety();

  requirePersistence();

  if (isPostgresConfigured()) {
    const connected = await checkPostgresConnection();
    if (!connected) {
      // Per HEL-80: production refuses to serve traffic against a broken DB.
      // Dev/test can continue with degraded knowledge routes for iteration.
      if (isProductionRuntime()) {
        logger.error(POSTGRES_UNREACHABLE_PRODUCTION_ERROR);
        throw new Error(POSTGRES_UNREACHABLE_PRODUCTION_ERROR);
      }
      logger.warn("[postgres] Database unreachable — knowledge routes will return empty results");
      return;
    }

    logger.log("[postgres] Connection verified");

    const appliedCount = await ensureSqlMigrationsApplied();
    logger.log(`[postgres] Applied ${appliedCount} SQL migration files`);

    try {
      await ensureKnowledgeSchema();
      logger.log("[knowledge] Schema initialized");
    } catch (err) {
      logger.error("[knowledge] Schema init failed:", (err as Error).message);
    }
  }
}
