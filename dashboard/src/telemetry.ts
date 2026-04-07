/**
 * telemetry.ts — Azure Application Insights bootstrap for the dashboard SPA.
 *
 * Initialised once from main.tsx. Safe no-op when the connection string env
 * var is absent (local dev, CI preview builds).
 *
 * Captured automatically:
 * - Page views (route changes tracked via React Router history)
 * - Unhandled JS exceptions and promise rejections
 * - Outbound fetch/XHR dependency calls
 * - Custom events via the exported `trackEvent` helper
 *
 * Environment variable (set in Vercel project settings):
 *   VITE_APPLICATIONINSIGHTS_CONNECTION_STRING
 */

import { ApplicationInsights } from "@microsoft/applicationinsights-web";

let appInsights: ApplicationInsights | null = null;

export function initTelemetry(): void {
  const connectionString = import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    return; // local dev — no-op
  }

  appInsights = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: true,      // page views on SPA navigation
      autoTrackPageVisitTime: true,
      enableCorsCorrelation: true,        // correlate frontend + backend traces
      enableRequestHeaderTracking: true,
      enableResponseHeaderTracking: true,
      disableFetchTracking: false,        // track outbound fetch calls
    },
  });

  appInsights.loadAppInsights();
  appInsights.trackPageView(); // record the initial page load
}

/** Track a named custom event with optional typed properties. */
export function trackEvent(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  appInsights?.trackEvent({ name }, properties);
}

/** Track an exception manually (e.g. from an error boundary). */
export function trackException(error: Error, properties?: Record<string, string>): void {
  appInsights?.trackException({ exception: error, properties });
}
