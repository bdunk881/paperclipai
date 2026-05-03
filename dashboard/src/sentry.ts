import React from "react";
import * as Sentry from "@sentry/react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    sendDefaultPii: true,
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
      // Forward console.log/info/warn/error to Sentry Logs endpoint
      // Note: do NOT add captureConsoleIntegration alongside this — both wrap
      // console.* methods and the conflict silently breaks log forwarding
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
      // Attach extra data from Error objects (.data, .cause, etc.)
      Sentry.extraErrorDataIntegration({ depth: 5 }),
      // Capture failed HTTP requests (4xx/5xx) as Sentry errors
      Sentry.httpClientIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
        buttonLabel: "Report a Bug",
        submitButtonLabel: "Send Report",
        formTitle: "Report a Bug",
      }),
    ],
    enableLogs: true,
    enableMetrics: true,
    tracesSampleRate: 1.0,
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/api\.helloautoflow\.com\/api/,
      /^https:\/\/staging-api\.helloautoflow\.com\/api/,
    ],
    profilesSampleRate: 1.0,
    replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });
}

export { Sentry };
