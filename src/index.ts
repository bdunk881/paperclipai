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
import { assertRequiredSecrets } from "./config/requiredSecrets";

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializePersistence();
  } catch (err) {
    console.error("[startup] Fatal initialization failure:", (err as Error).message);
    process.exit(1);
  }

  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();

  // HEL-500: fail fast in production when a required secret is unset (mirrors
  // HEL-262's connector-key fail-fast); warn for recommended/feature-gating
  // secrets in every environment. No-op when everything is configured.
  assertRequiredSecrets({ isProduction: runtimeEnv === "production" });

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
    { startDirectProviderHealthJobs },
    { startStorageLifecycleReconcileJob },
    { startWorkflowFailureDigestJob },
  ] = await Promise.all([
    import("./billing/credits/openrouterHealthJob"),
    import("./billing/credits/creditExpirationJob"),
    import("./billing/credits/creditAnomalyDetectorJob"),
    import("./billing/credits/creditAutoTopupJob"),
    import("./billing/credits/stripeIssuing"),
    import("./billing/credits/sourceHealthJob"),
    import("./storage/storageLifecycleReconcileJob"),
    import("./engine/failureDigest/failureDigest"),
  ]);
  startOpenrouterHealthJob();
  startCreditExpirationJob();
  startCreditAnomalyDetector();
  startCreditAutoTopupJob();
  // HEL-599: Stripe Issuing treasury underfund watchdog. No-op unless
  // STRIPE_ISSUING_ENABLED is set (the whole treasury layer ships disabled).
  startIssuingTreasuryJob();
  // HEL-601: per-provider direct funding watchdogs (Anthropic + OpenAI). Also
  // gated on STRIPE_ISSUING_ENABLED — no-op until go-live.
  startDirectProviderHealthJobs();
  // HEL-358: storage lifecycle drift watchdog. No-op unless STORAGE_PROVIDER
  // is a lifecycle-capable backend (r2/s3); the in-memory adapter is skipped.
  startStorageLifecycleReconcileJob();
  // HEL-365: daily workflow-failure digest to workspace owners. No-op unless
  // Postgres is configured; respects per-workspace opt-out + the SES mailer's
  // own gating (logs until AUTOFLOW_SYSTEM_EMAIL_FROM is set).
  startWorkflowFailureDigestJob();

  // HEL-614/HEL-615: register env-configured comms transports (Telnyx SMS,
  // managed SES customer email) on the process-wide gateway. Each is env-gated,
  // so an unconfigured environment registers nothing and comms.send throws a
  // clear "no transport" error rather than failing silently — this is the call
  // that first makes the comms gateway live.
  const { commsGateway, registerCommsTransports } = await import("./comms");
  const commsTransports = registerCommsTransports(commsGateway);
  if (commsTransports.length > 0) {
    console.log(`[comms] registered transports: ${commsTransports.join(", ")}`);
  }

  // HEL-729: surface degraded comms providers (the failover circuit breaker
  // snapshot) on a periodic tick. No-op output unless a provider is open.
  const { startCommsProviderHealthJob } = await import("./comms/providerHealthJob");
  startCommsProviderHealthJob();
}

void startServer();
