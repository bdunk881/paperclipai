/**
 * Structured logger for cf-worker client calls. Mirrors the shape used by
 * each per-integration logger under src/integrations — single-line JSON,
 * level-routed via console.{log,warn,error}.
 */
type CfWorkerLogEvent =
  | { event: "call_ok"; level: "info"; path: string; durationMs: number; status: number }
  | { event: "call_non_2xx"; level: "warn"; path: string; durationMs: number; status: number }
  | { event: "call_timeout"; level: "warn"; path: string; durationMs: number; timeoutMs: number }
  | { event: "call_network_error"; level: "warn"; path: string; durationMs: number; error: string }
  | { event: "call_skipped_no_base_url"; level: "warn"; path: string };

export function logCfWorker(
  ev: CfWorkerLogEvent & { metadata?: Record<string, unknown> },
): void {
  const payload = { ts: new Date().toISOString(), source: "cf_worker_client", ...ev };
  const serialized = JSON.stringify(payload);
  if (ev.level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}
