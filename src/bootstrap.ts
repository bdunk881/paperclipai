import { checkPostgresConnection, isPostgresConfigured } from "./db/postgres";
import { ensureSqlMigrationsApplied } from "./db/sqlMigrations";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";
import { loadSecretsFromKeyVault } from "./secrets/keyVaultSecrets";

type Logger = Pick<typeof console, "log" | "warn" | "error">;

export async function initializePersistence(logger: Logger = console): Promise<void> {
  await loadSecretsFromKeyVault();

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
