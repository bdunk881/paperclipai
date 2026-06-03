/**
 * Server-side client for calling the Cloudflare Worker (cf-worker/) from
 * the Fly-hosted Express API.
 *
 * Every DO call site goes through `callWorker` so timeout, fail-open vs
 * fail-closed, and observability are centralized. Per HEL-291's stated
 * fallback policy: default to fail-open with a structured warn log, so a
 * Worker outage degrades rate-limiting / quotas to allow-all rather than
 * blocking all customer traffic. Security-sensitive callers can opt into
 * fail-closed.
 */
import { logCfWorker } from "./logger";

export type CfWorkerFailureMode = "fail-open" | "fail-closed";

export type CfWorkerErrorReason =
  | "timeout"
  | "non_2xx"
  | "network"
  | "no_base_url";

export interface CallWorkerOptions {
  /** Per-call timeout in ms. Default 100. */
  timeoutMs?: number;
  /** Behavior on any failure. Default fail-open. */
  onFailure?: CfWorkerFailureMode;
  /** Optional extra fields included in every log line for this call. */
  metadata?: Record<string, unknown>;
}

export type CallWorkerResult<T> =
  | { ok: true; data: T; status: number; durationMs: number }
  | { ok: false; data: null; errorReason: CfWorkerErrorReason; durationMs: number };

const DEFAULT_TIMEOUT_MS = 100;

/**
 * Calls `${CF_WORKER_BASE_URL}${path}` with the provided init. Returns a
 * discriminated result rather than throwing — callers that want
 * fail-closed semantics get an exception by opting in.
 */
export async function callWorker<T>(
  path: string,
  init: RequestInit,
  opts: CallWorkerOptions = {},
): Promise<CallWorkerResult<T>> {
  const baseUrl = process.env.CF_WORKER_BASE_URL;
  if (!baseUrl) {
    logCfWorker({ event: "call_skipped_no_base_url", level: "warn", path, metadata: opts.metadata });
    if (opts.onFailure === "fail-closed") {
      throw new Error("CF_WORKER_BASE_URL is not configured");
    }
    return { ok: false, data: null, errorReason: "no_base_url", durationMs: 0 };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  // HEL-427: authenticate to the worker. Its rate-limit routes now require
  // `Authorization: Bearer <CF_WORKER_SHARED_SECRET>`; attach it here so every
  // worker call is authenticated. The same secret must be set on the worker
  // (`wrangler secret put`) and this backend's env. If it's unset the header
  // is omitted and the (fail-closed) worker rejects — rate-limit consume is
  // fail-open, so traffic still flows during rollout.
  const headers = new Headers(init.headers);
  const sharedSecret = process.env.CF_WORKER_SHARED_SECRET;
  if (sharedSecret) {
    headers.set("Authorization", `Bearer ${sharedSecret}`);
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      logCfWorker({
        event: "call_non_2xx",
        level: "warn",
        path,
        durationMs,
        status: res.status,
        metadata: opts.metadata,
      });
      if (opts.onFailure === "fail-closed") {
        throw new Error(`cf-worker ${path} returned ${res.status}`);
      }
      return { ok: false, data: null, errorReason: "non_2xx", durationMs };
    }
    const data = (await res.json()) as T;
    logCfWorker({
      event: "call_ok",
      level: "info",
      path,
      durationMs,
      status: res.status,
      metadata: opts.metadata,
    });
    return { ok: true, data, status: res.status, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) {
      logCfWorker({
        event: "call_timeout",
        level: "warn",
        path,
        durationMs,
        timeoutMs,
        metadata: opts.metadata,
      });
      if (opts.onFailure === "fail-closed") {
        throw err;
      }
      return { ok: false, data: null, errorReason: "timeout", durationMs };
    }
    logCfWorker({
      event: "call_network_error",
      level: "warn",
      path,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
      metadata: opts.metadata,
    });
    if (opts.onFailure === "fail-closed") {
      throw err;
    }
    return { ok: false, data: null, errorReason: "network", durationMs };
  } finally {
    clearTimeout(timer);
  }
}
