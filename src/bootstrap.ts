import { checkPostgresConnection, inMemoryAllowed, isPostgresConfigured } from "./db/postgres";
import { ensureSqlMigrationsApplied } from "./db/sqlMigrations";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";

type Logger = Pick<typeof console, "log" | "warn" | "error">;

export { inMemoryAllowed };

export const PERSISTENCE_REQUIRED_ERROR =
  "DATABASE_URL is required for AutoFlow persistence outside development/test. " +
  "Set DATABASE_URL before starting the server, or run with NODE_ENV=development/test for process-local storage.";

export function requirePersistence(): void {
  if (isPostgresConfigured() || inMemoryAllowed()) {
    return;
  }

  throw new Error(PERSISTENCE_REQUIRED_ERROR);
}

export async function initializePersistence(logger: Logger = console): Promise<void> {
  requirePersistence();

  if (isPostgresConfigured()) {
    const connected = await checkPostgresConnection();
    if (!connected) {
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
