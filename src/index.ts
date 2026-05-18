// DASH-29: MUST be the first import. instrument.ts calls Sentry.init()
// at module evaluation; if anything else loads first, the SDK's auto-
// integrations (express, postgres, http, console-logging) attach to
// already-required modules and silently drop captures + logs.
//
// Diagnosed when zero backend events landed in Sentry across DASH-21
// through DASH-28 despite every Sentry.captureException being wired
// correctly — the SDK was never initialized because nothing imported
// `instrument`.
import "./instrument";
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
