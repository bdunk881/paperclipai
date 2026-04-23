import app from "./app";
import { checkPostgresConnection, isPostgresConfigured } from "./db/postgres";
import { ensureKnowledgeSchema } from "./knowledge/knowledgeStore";
import { WORKFLOW_TEMPLATES } from "./templates";

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`AutoFlow API running on port ${PORT}`);
  console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);

  if (isPostgresConfigured()) {
    const connected = await checkPostgresConnection();
    if (connected) {
      console.log("[postgres] Connection verified");
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
});
