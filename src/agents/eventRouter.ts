/**
 * Event router (HEL-94).
 *
 * Single entry point that webhook handlers / @-mention publishers / approval
 * resolvers call when they have a potential wake event. The router:
 *
 *   1. Persists the event (publishWakeEvent → wake_events table)
 *   2. Resolves which agent(s) the event concerns (via routine bindings, the
 *      org chart, mention parsing, etc.) — caller's responsibility to fill in
 *      the resolution; v1 expects an explicit candidate_agent_id from the
 *      caller. Multi-agent fan-out is a follow-up.
 *   3. Triages each candidate via triagePolicy.ts
 *   4. For decision=ACT, enqueues the actual agent boot (P3 BullMQ work)
 *
 * v1 ships the dispatch shape + triage integration. The actual BullMQ enqueue
 * is a no-op stub here — the orchestrator that exists today (engine/runStore
 * + the runtime BullMQ work in P3) hooks into the `onAct` callback when it's
 * ready.
 */

import type { Pool } from "pg";
import {
  publishAndTriageEvent,
  type TriageInvoker,
} from "./triagePolicy";
import type { PublishInput, WakeEvent } from "./wakeEventStore";

export interface RouteEventArgs extends Omit<PublishInput, "workspaceId" | "userId"> {
  workspaceId: string;
  userId: string;
  /**
   * The candidate agent the event concerns. v1 expects exactly one; multi-
   * agent fan-out is a follow-up. Caller is responsible for resolving via
   * routine bindings / org chart / mention parsing before calling routeEvent.
   */
  candidateAgentId?: string | null;
  /**
   * Identity card text the triage call uses ("Atlas: outbound sales agent in
   * the Acme workspace, reports to Cleo").
   */
  agentIdentityCard?: string;
}

export interface RouteEventDeps {
  pool: Pool;
  /** Wired by the orchestrator once boot machinery is ready. v1 stub no-ops. */
  onAct?: (event: WakeEvent) => Promise<void>;
  /** Wired by the orchestrator. v1 stub no-ops; the event row carries the deferred_until timestamp. */
  onDefer?: (event: WakeEvent) => Promise<void>;
  /** Wired by the orchestrator. v1 stub no-ops. */
  onEscalate?: (event: WakeEvent) => Promise<void>;
  /** LLM hook for the triage call. v1 ships DEFAULT_TRIAGE_INVOKER (no LLM, rule-based). */
  triageInvoker?: TriageInvoker;
}

export async function routeEvent(
  deps: RouteEventDeps,
  args: RouteEventArgs,
): Promise<WakeEvent | null> {
  const event = await publishAndTriageEvent(
    deps.pool,
    {
      workspaceId: args.workspaceId,
      userId: args.userId,
      agentId: args.candidateAgentId ?? null,
      source: args.source,
      sourceRef: args.sourceRef ?? null,
      summary: args.summary,
      payload: args.payload ?? {},
    },
    {
      agentId: args.candidateAgentId ?? "",
      agentIdentityCard: args.agentIdentityCard ?? "",
    },
    deps.triageInvoker,
  );

  if (!event) return null;

  // Dispatch on decision — orchestrator hooks in here when ready
  switch (event.decision) {
    case "ACT":
      await deps.onAct?.(event);
      break;
    case "DEFER":
      await deps.onDefer?.(event);
      break;
    case "ESCALATE":
      await deps.onEscalate?.(event);
      break;
    case "IGNORE":
    case "PENDING":
      // No-op; the event row is the record.
      break;
  }

  return event;
}
