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
  const server = app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });

  // HEL-286: y-websocket upgrade handler for collaborative workflow editing.
  // Gated on Postgres because the snapshot store is Postgres-only; the
  // in-memory dev mode skips collab transport (the dashboard's Studio uses
  // the legacy SSE presence channel as a fallback there).
  const { isPostgresPersistenceEnabled, getPostgresPool } = await import("./db/postgres");
  if (isPostgresPersistenceEnabled()) {
    const { attachYDocUpgradeHandler } = await import(
      "./workflows/ydoc/attachYDocUpgradeHandler"
    );
    const ydocAttachment = attachYDocUpgradeHandler(server, { pool: getPostgresPool() });
    const shutdown = (signal: string) => {
      console.log(`[ydoc] ${signal} received; flushing rooms…`);
      void ydocAttachment.detach().then(() => {
        console.log("[ydoc] flush complete");
      });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  // HEL-credits-mvp: start the credits-mode background jobs after the
  // server is accepting traffic. All no-op gracefully when Postgres
  // isn't configured (in-memory dev / test).
  const [
    { startOpenrouterHealthJob },
    { startCreditExpirationJob },
    { startCreditAnomalyDetector },
    { startCreditAutoTopupJob },
    { startIssuingTreasuryJob },
  ] = await Promise.all([
    import("./billing/credits/openrouterHealthJob"),
    import("./billing/credits/creditExpirationJob"),
    import("./billing/credits/creditAnomalyDetectorJob"),
    import("./billing/credits/creditAutoTopupJob"),
    import("./billing/credits/stripeIssuing"),
  ]);
  startOpenrouterHealthJob();
  startCreditExpirationJob();
  startCreditAnomalyDetector();
  startCreditAutoTopupJob();
  // HEL-599: Stripe Issuing treasury underfund watchdog. No-op unless
  // STRIPE_ISSUING_ENABLED is set (the whole treasury layer ships disabled).
  startIssuingTreasuryJob();
}

void startServer();
