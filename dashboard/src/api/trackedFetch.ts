import * as Sentry from "@sentry/react";
import { withActiveWorkspaceHeader } from "../workspaces/workspaceStorage";

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

// Global 429 cooldown. When the backend's express-rate-limit emits 429, it
// also sends Retry-After. We honor it by short-circuiting new requests to
// a synthetic 429 response for the same window. Otherwise React effects fire
// dozens of requests per second from re-mounting components and the user
// gets stuck in an unrecoverable loop. Caller code already handles 429 as
// a normal `!res.ok` branch.
let cooldownUntilMs = 0;
let cachedCooldownReason: string | null = null;

function recordRetryAfter(headers: Headers): void {
  const raw = headers.get("Retry-After");
  if (!raw) return;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  // Cap the cooldown at 60s so a misconfigured Retry-After can't lock the
  // dashboard out for an hour.
  const cappedMs = Math.min(seconds, 60) * 1000;
  cooldownUntilMs = Math.max(cooldownUntilMs, Date.now() + cappedMs);
  cachedCooldownReason = `Rate limit cooldown for ${cappedMs / 1000}s`;
}

function makeCooldownResponse(): Response {
  return new Response(
    JSON.stringify({ error: cachedCooldownReason ?? "Rate limit cooldown" }),
    {
      status: 429,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export interface TrackedFetchOptions {
  /**
   * Per-call override for the default 15s abort timeout. Useful for
   * endpoints that intentionally do slow work (LLM calls, big imports)
   * where the dashboard would otherwise abort the request mid-flight and
   * surface a confusing "Request timed out" even though the backend is
   * still working. Keep the default short — only widen it when the
   * server-side budget genuinely exceeds 15s. Capped at 300s defensively
   * so a misuse can't lock the dashboard's spinner forever.
   */
  timeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_TIMEOUT_MS = 300_000;

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: TrackedFetchOptions,
): Promise<Response> {
  if (Date.now() < cooldownUntilMs) {
    return makeCooldownResponse();
  }

  // Default 15s timeout. Otherwise a backend that hangs (slow Postgres query,
  // worker crash, network blackhole) leaves the React effect's try/finally
  // never running and the spinner spins forever. If the caller already passed
  // an AbortSignal we chain through; otherwise we own the controller.
  const requestedTimeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const FETCH_TIMEOUT_MS = Math.max(
    1_000,
    Math.min(requestedTimeoutMs, MAX_FETCH_TIMEOUT_MS),
  );
  const callerSignal = init?.signal ?? undefined;
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const nextInit: RequestInit = {
    ...init,
    headers: withActiveWorkspaceHeader(init?.headers),
    signal: controller.signal,
  };
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  const method = (
    nextInit.method ??
    (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const endpoint = normalizeEndpoint(url);

  const start = performance.now();
  let statusCode = 0;

  try {
    const res = await fetch(input, nextInit);
    statusCode = res.status;
    if (statusCode === 429) {
      recordRetryAfter(res.headers);
    }
    return res;
  } catch (err) {
    // Surface a friendlier message for the timeout case so callers don't
    // just see "The user aborted a request." in their error state.
    const isAbort =
      err instanceof DOMException && err.name === "AbortError" && !callerSignal?.aborted;
    const surfaceErr = isAbort
      ? new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${method} ${endpoint}`)
      : err;
    Sentry.metrics.count("api.network_error", 1, {
      attributes: { endpoint, method, kind: isAbort ? "timeout" : "network" },
    });
    Sentry.logger.error(`Network error: ${method} ${endpoint}`, {
      endpoint,
      method,
      kind: isAbort ? "timeout" : "network",
    });
    Sentry.captureException(surfaceErr, {
      level: "error",
      tags: { endpoint, method, kind: isAbort ? "api_timeout" : "api_network_error" },
      contexts: { request: { url, method, timeoutMs: FETCH_TIMEOUT_MS } },
      fingerprint: [isAbort ? "api_timeout" : "api_network_error", method, endpoint],
    });
    throw surfaceErr;
  } finally {
    window.clearTimeout(timeoutHandle);
    const duration = Math.round(performance.now() - start);

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

    if (statusCode >= 500) {
      Sentry.logger.error(`${method} ${endpoint} → ${statusCode} (${duration}ms)`, {
        endpoint,
        method,
        status: statusCode,
        duration,
      });
      // Also raise an Issue (not just a Log) so 5xx spikes are alertable.
      Sentry.captureException(
        new Error(`api_5xx: ${method} ${endpoint} → ${statusCode}`),
        {
          level: "error",
          tags: { endpoint, method, status: String(statusCode), kind: "api_5xx" },
          contexts: {
            request: { url, method, status: statusCode, duration_ms: duration },
          },
          fingerprint: ["api_5xx", method, endpoint, String(statusCode)],
        },
      );
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
