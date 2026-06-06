/**
 * Comms provider health — a process-local circuit breaker (HEL-729).
 *
 * Fed by the gateway's failover loop: consecutive *retryable* failures open a
 * provider's circuit so `resolveTransports` proactively SKIPS it on the next
 * send (rather than only reacting to a live 5xx); a success — or a cooldown
 * half-open followed by a success — closes it. Email/SMS providers have no
 * meaningful synchronous "ping", so real send outcomes ARE the health signal.
 * Process-local is the right granularity: "should THIS process try provider X".
 */

/** Consecutive retryable failures that open a provider's circuit. */
export const FAILURE_THRESHOLD = 3;
/** After this long, an open circuit half-opens (one trial send is allowed). */
export const COOLDOWN_MS = 60_000;

interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null; // ms when the circuit opened; null = closed
}

// allowlist: process-local provider-health circuit breaker (runtime registry, not customer data)
const circuits = new Map<string, CircuitState>();

/** A successful send (or non-error transport response) closes the circuit. */
export function recordSuccess(providerId: string): void {
  circuits.set(providerId, { consecutiveFailures: 0, openedAt: null });
}

/** A retryable failure; opens the circuit once it reaches the threshold. */
export function recordFailure(providerId: string, now: number = Date.now()): void {
  const prev = circuits.get(providerId) ?? { consecutiveFailures: 0, openedAt: null };
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const openedAt =
    consecutiveFailures >= FAILURE_THRESHOLD ? prev.openedAt ?? now : prev.openedAt;
  circuits.set(providerId, { consecutiveFailures, openedAt });
}

/** Healthy unless the circuit is open AND still within the cooldown window. */
export function isHealthy(providerId: string, now: number = Date.now()): boolean {
  const c = circuits.get(providerId);
  if (!c || c.openedAt === null) {
    return true; // never failed / closed
  }
  return now - c.openedAt >= COOLDOWN_MS; // half-open after the cooldown
}

export interface ProviderHealthEntry {
  providerId: string;
  healthy: boolean;
  consecutiveFailures: number;
  /** How long the circuit has been open, ms (null when closed). */
  openMs: number | null;
}

export function snapshot(now: number = Date.now()): ProviderHealthEntry[] {
  return Array.from(circuits.entries()).map(([providerId, c]) => ({
    providerId,
    healthy: isHealthy(providerId, now),
    consecutiveFailures: c.consecutiveFailures,
    openMs: c.openedAt === null ? null : now - c.openedAt,
  }));
}

export function resetProviderHealthForTests(): void {
  circuits.clear();
}
