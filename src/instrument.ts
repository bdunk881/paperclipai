import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
    profileSessionSampleRate: 1.0,
    sendDefaultPii: true,
    enableLogs: true,
    integrations: [
      // HTTP/network tracing
      Sentry.httpIntegration(),
      Sentry.nativeNodeFetchIntegration({ breadcrumbs: true }),
      // Express route + error tracing
      Sentry.expressIntegration(),
      // PostgreSQL query tracing
      Sentry.postgresIntegration(),
      // Console → Sentry Logs (backend console.log/warn/error)
      Sentry.consoleIntegration(),
      // Capture console calls as Sentry breadcrumbs + events
      Sentry.captureConsoleIntegration({ levels: ["warn", "error"] }),
      // Attach extra data from Error objects (.data, .cause, etc.)
      Sentry.extraErrorDataIntegration({ depth: 5 }),
      // Source code context around error frames
      Sentry.contextLinesIntegration(),
      // Node.js process/OS context (memory, uptime, etc.)
      Sentry.nodeContextIntegration(),
      // Node.js runtime metrics (event loop lag, heap, gc)
      Sentry.nodeRuntimeMetricsIntegration(),
      // Unhandled promise rejections
      Sentry.onUnhandledRejectionIntegration({ mode: "warn" }),
      // Uncaught exceptions
      Sentry.onUncaughtExceptionIntegration(),
      // Request data (body, headers, IP) on error events
      Sentry.requestDataIntegration(),
    ],
  });
}
