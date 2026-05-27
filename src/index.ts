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

  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl && (runtimeEnv === "development" || runtimeEnv === "test")) {
    console.warn(
      "[auth] SUPABASE_URL is unset. Dashboard sign-in will succeed in the browser, but /api routes " +
        "that require Bearer JWT verification will return 503 until SUPABASE_URL matches the dashboard project.",
    );
  }

  const [{ default: app }, { WORKFLOW_TEMPLATES }] = await Promise.all([
    import("./app"),
    import("./templates"),
  ]);
  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });

  // HEL-credits-mvp: start the credits-mode background jobs after the
  // server is accepting traffic. All three no-op gracefully when
  // Postgres isn't configured (in-memory dev / test).
  const [
    { startOpenrouterHealthJob },
    { startCreditExpirationJob },
    { startCreditAnomalyDetector },
  ] = await Promise.all([
    import("./billing/credits/openrouterHealthJob"),
    import("./billing/credits/creditExpirationJob"),
    import("./billing/credits/creditAnomalyDetectorJob"),
  ]);
  startOpenrouterHealthJob();
  startCreditExpirationJob();
  startCreditAnomalyDetector();
}

void startServer();
