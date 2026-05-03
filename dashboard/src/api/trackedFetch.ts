import * as Sentry from "@sentry/react";

function normalizeEndpoint(url: string): string {
  return (
    url
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\?.*$/, "")
      // UUIDs → :id
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
      // Long numeric IDs → :id
      .replace(/\/\d{4,}/g, "/:id") || "/unknown"
  );
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  const method = (
    init?.method ??
    (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const endpoint = normalizeEndpoint(url);

  const start = performance.now();
  let statusCode = 0;

  try {
    const res = await fetch(input, init);
    statusCode = res.status;
    return res;
  } catch (err) {
    Sentry.metrics.count("api.network_error", 1, { attributes: { endpoint, method } });
    Sentry.logger.error(`Network error: ${method} ${endpoint}`, { endpoint, method });
    throw err;
  } finally {
    const duration = Math.round(performance.now() - start);

    // Emit metrics
    Sentry.metrics.distribution("api.response_time_ms", duration, {
      unit: "millisecond",
      attributes: { endpoint, method, status: String(statusCode) },
    });
    Sentry.metrics.count("api.request", 1, { attributes: { endpoint, method } });
    if (statusCode >= 400) {
      Sentry.metrics.count("api.error", 1, {
        attributes: { endpoint, method, status: String(statusCode) },
      });
    }

    // Emit logs — these route directly to the Sentry Logs endpoint
    // (Sentry.logger bypasses console interception entirely)
    if (statusCode >= 500) {
      Sentry.logger.error(`${method} ${endpoint} → ${statusCode} (${duration}ms)`, {
        endpoint,
        method,
        status: statusCode,
        duration,
      });
    } else if (statusCode >= 400) {
      Sentry.logger.warn(`${method} ${endpoint} → ${statusCode} (${duration}ms)`, {
        endpoint,
        method,
        status: statusCode,
        duration,
      });
    } else if (statusCode > 0) {
      Sentry.logger.info(`${method} ${endpoint} → ${statusCode} (${duration}ms)`, {
        endpoint,
        method,
        status: statusCode,
        duration,
      });
    }
  }
}
