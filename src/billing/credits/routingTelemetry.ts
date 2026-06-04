/**
 * Routing telemetry (HEL-603).
 *
 * Sub-agent affinity routing keeps a `delegate_to_subagent` fan-out on the
 * SAME upstream key source as the parent so Anthropic's prompt cache stays
 * warm across the chain (cached Sonnet input is 0.30 vs 3.00 USD/Mtok — a
 * ~10× discount). `routing.affinity_used` is the hit-rate signal: it fires
 * once per call whenever `pickKeySource` resolves a `preferSourceId` hint to
 * an eligible source instead of falling through to priority selection.
 *
 * Emitted as a Sentry metric counter (the repo's established custom-metric
 * idiom — see `src/app.ts`) plus a structured log line for log-based
 * measurement and local visibility. Telemetry must never break routing, so
 * every emit is wrapped: a Sentry/transport failure is swallowed.
 */
import * as Sentry from "@sentry/node";

export interface RoutingAffinityUsedEvent {
  /** The key source we stuck to (the parent's). */
  sourceId: string;
  /** Upstream provider the call was for. */
  provider: string;
  /** Source kind of the chosen row ("openrouter" | "direct"). */
  sourceKind: string;
}

export function emitRoutingAffinityUsed(event: RoutingAffinityUsedEvent): void {
  try {
    Sentry.metrics.count("routing.affinity_used", 1, {
      attributes: { provider: event.provider, source_kind: event.sourceKind },
    });
  } catch {
    // Metrics transport not initialized (CI / local) or failed — never let
    // a telemetry hiccup take down a billable LLM call.
  }
  console.log(
    `[routing] affinity_used source=${event.sourceId} provider=${event.provider} kind=${event.sourceKind}`,
  );
}
