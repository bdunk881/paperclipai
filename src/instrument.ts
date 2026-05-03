import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
    profileSessionSampleRate: 1.0,
    sendDefaultPii: true,
    enableLogs: true,
    enableMetrics: true,
    integrations: [
      // Native Node.js CPU profiling (requires @sentry/profiling-node)
      nodeProfilingIntegration(),
      // HTTP/network tracing
      Sentry.httpIntegration(),
      Sentry.nativeNodeFetchIntegration({ breadcrumbs: true }),
      // Express route + error tracing
      Sentry.expressIntegration(),
      // PostgreSQL query tracing
      Sentry.postgresIntegration(),
      // Route console.* calls to Sentry Logs endpoint (requires enableLogs: true)
      // Note: do NOT add captureConsoleIntegration alongside this — both wrap
      // console.* methods and the conflict silently breaks log forwarding
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
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
