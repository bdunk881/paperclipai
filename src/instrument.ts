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
    // Tag every event with the deployed sha so Sentry "Releases" maps
    // a stack frame to a known commit. Falls back to the GitHub Action
    // env var; in local dev where neither is set Sentry tags as
    // "unknown" rather than crashing init.
    release:
      process.env.SENTRY_RELEASE ??
      process.env.GITHUB_SHA ??
      process.env.FLY_IMAGE_REF ??
      undefined,
    tracesSampleRate: 1.0,
    // DASH-33: in v10 the supported continuous-profiling shape is
    // { profileLifecycle: "trace" } + the profiling integration. That
    // captures a CPU profile for every traced request automatically.
    // profilesSampleRate is left on as a belt-and-suspenders for
    // transaction-bound profiling on hosts that don't honor
    // profileLifecycle yet.
    profilesSampleRate: 1.0,
    profileLifecycle: "trace",
    // DASH-33: dev hostnames were missing — frontend → backend traces
    // didn't link up for any dev request. Added autoflow-api-dev
    // (Fly internal) AND dev-api.helloautoflow.com (Cloudflare
    // CNAME). Same shape for staging + prod to be safe.
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/api\.helloautoflow\.com/,
      /^https:\/\/staging-api\.helloautoflow\.com/,
      /^https:\/\/dev-api\.helloautoflow\.com/,
      /^https:\/\/autoflow-api-(?:dev|staging|production)\.fly\.dev/,
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
      // DASH-33: native LLM-call tracing. Sentry v10 ships first-party
      // integrations for Anthropic, OpenAI, and Google Gen AI that
      // monkey-patch the SDKs to auto-emit spans per messages.create /
      // chat.completions call with prompt/response token counts.
      // Without these, our LLM calls show up as opaque outbound HTTP
      // requests; with them, each one becomes a labeled span we can
      // search in Performance + correlate with cost log rows.
      Sentry.anthropicAIIntegration(),
      Sentry.openAIIntegration(),
      Sentry.googleGenAIIntegration(),
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
