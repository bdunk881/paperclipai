import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN;

// DASH-29: explicit boot log + DSN tail so a future "is Sentry up?"
// check is a single grep in Fly logs instead of another diagnostic
// round. We log the DSN's last 6 chars only — enough to identify
// which Sentry project the worker is talking to without leaking the
// public key in plain text.
if (!dsn) {
  console.warn(
    "[sentry] SENTRY_DSN is unset. Backend events will NOT reach Sentry. " +
      "Set it via: fly secrets set SENTRY_DSN=… -a <app>",
  );
} else {
  console.log(
    `[sentry] initializing with DSN tail …${dsn.slice(-8)} env=${
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"
    }`,
  );
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/api\.helloautoflow\.com/,
      /^https:\/\/staging-api\.helloautoflow\.com/,
    ],
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
  console.log("[sentry] init complete");
}
