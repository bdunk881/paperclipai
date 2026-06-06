/**
 * Periodic comms provider-health observability (HEL-729).
 *
 * The circuit breaker (providerHealth.ts) recovers on its own via the cooldown
 * half-open, so this job doesn't drive recovery — it just surfaces degraded
 * providers in the logs each tick so ops sees a flapping provider without
 * waiting for the next send to fail. Mirrors the other startup watchdogs;
 * unref'd so it never keeps the process alive.
 */

import { snapshot } from "./providerHealth";

let _timer: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 60_000;

export function startCommsProviderHealthJob(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  if (_timer) {
    return _timer;
  }
  _timer = setInterval(() => {
    const degraded = snapshot().filter((entry) => !entry.healthy);
    if (degraded.length > 0) {
      console.warn(
        "[comms:health] degraded providers: " +
          degraded
            .map((d) => `${d.providerId} (open ${Math.round((d.openMs ?? 0) / 1000)}s)`)
            .join(", "),
      );
    }
  }, intervalMs);
  _timer.unref?.();
  return _timer;
}

export function stopCommsProviderHealthJobForTests(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
