import { initializePersistence } from "./bootstrap";

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializePersistence();
  } catch (err) {
    console.error("[startup] Fatal initialization failure:", (err as Error).message);
    process.exit(1);
  }

  const [{ default: app }, { WORKFLOW_TEMPLATES }] = await Promise.all([
    import("./app"),
    import("./templates"),
  ]);
  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });
}

void startServer();
