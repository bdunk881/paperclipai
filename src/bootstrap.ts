import { checkPostgresConnection, isPostgresConfigured } from "./db/postgres";
import { ensureSqlMigrationsApplied } from "./db/sqlMigrations";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";
import { assertProductionSafety } from "./security/qaBypassGuard";

type Logger = Pick<typeof console, "log" | "warn" | "error">;

export async function initializePersistence(logger: Logger = console): Promise<void> {
  // Phase 5 production-boot guard: refuse to start if any QA / test bypass
  // flag is asserted in a production-shaped environment. Runs before any
  // other startup work so a misconfiguration cannot accept a single request.
  assertProductionSafety();

  if (!isPostgresConfigured()) {
    return;
  }

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
