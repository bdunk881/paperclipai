import { checkPostgresConnection, isPostgresConfigured } from "./db/postgres";
import { ensureSqlMigrationsApplied } from "./db/sqlMigrations";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";
import { WORKFLOW_TEMPLATES } from "./templates";

const PORT = process.env.PORT || 3000;

async function startServer() {
  if (isPostgresConfigured()) {
    const connected = await checkPostgresConnection();
    if (connected) {
      console.log("[postgres] Connection verified");
      try {
        const appliedCount = await ensureSqlMigrationsApplied();
        console.log(`[postgres] Applied ${appliedCount} SQL migration files`);
      } catch (err) {
        console.error("[postgres] SQL migrations failed:", (err as Error).message);
      }
      try {
        await ensureKnowledgeSchema();
        console.log("[knowledge] Schema initialized");
      } catch (err) {
        console.error("[knowledge] Schema init failed:", (err as Error).message);
      }
    } else {
      console.warn("[postgres] Database unreachable — knowledge routes will return empty results");
    }
  }

  const { default: app } = await import("./app");
  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });
}

void startServer();
