import "./instrument";
import { initializePersistence } from "./bootstrap";
import { WORKFLOW_TEMPLATES } from "./templates";

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializePersistence();
  } catch (err) {
    console.error("[startup] Fatal PostgreSQL initialization failure:", (err as Error).message);
    process.exit(1);
  }

  const { default: app } = await import("./app");
  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });
}

void startServer();
