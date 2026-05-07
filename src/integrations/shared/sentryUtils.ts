import * as Sentry from "@sentry/node";

/**
 * Captures an integration error in Sentry with structured context.
 * Use this in catch blocks across connector integrations instead of console.error.
 */
export function captureIntegrationError(
  integration: string,
  operation: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("integration", integration);
    scope.setTag("operation", operation);
    if (extra) {
      scope.setContext("integration_context", extra);
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(`[${integration}] ${operation} failed: ${String(error)}`, "error");
    }
  });
}

/**
 * Wraps an async integration operation in a Sentry span for latency tracking.
 */
export function withIntegrationSpan<T>(
  integration: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    { name: `${integration}.${operation}`, op: `integration.${integration}` },
    fn,
  );
}
