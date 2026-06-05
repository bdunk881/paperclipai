/**
 * Inbound comms ingest (HEL-613).
 *
 * Takes a {@link NormalizedInboundEvent}, resolves which tenant/agent it
 * belongs to, dedupes provider retries, then publishes to `wake_events` and
 * triages via the existing router. On a triage ACT, the wake dispatcher boots a
 * real agent run (the option-B wiring). Every seam is injectable for tests.
 */

import type { Pool } from "pg";
import { routeEvent, type RouteEventDeps } from "../../agents/eventRouter";
import { createWakeActDispatcher } from "../../agents/wakeDispatch";
import type { TriageInvoker } from "../../agents/triagePolicy";
import {
  findWakeEventByDedupeKey,
  type WakeDecision,
  type WakeEvent,
} from "../../agents/wakeEventStore";
import { commsSendStore } from "../commsSendStore";
import type { CommsChannel } from "../types";
import { inboundRouteStore } from "./inboundRouteStore";
import type { InboundTenancy, NormalizedInboundEvent } from "./types";

export interface CommsInboundIngestResult {
  status: "ok" | "duplicate" | "unrouted";
  wakeEventId?: string;
  decision?: WakeDecision;
}

export interface CommsInboundIngestDeps {
  pool: Pool;
  /** Triage LLM hook. Default: routeEvent's rule-based default. */
  triageInvoker?: TriageInvoker;
  /** ACT dispatcher (onAct). Default: createWakeActDispatcher({ pool }). */
  onAct?: (event: WakeEvent) => Promise<void>;
  /** Resolve an inbound address → workspace/agent. Default: inboundRouteStore. */
  resolveRoute?: (
    channel: CommsChannel,
    address: string,
  ) => Promise<{ workspaceId: string; agentId: string | null } | null>;
  /** Resolve a send by provider message id. Default: commsSendStore. */
  resolveSend?: (
    provider: string,
    providerMessageId: string,
  ) => Promise<InboundTenancy | null>;
  /** Resolve the RLS actor (a workspace member). Default: workspace owner. */
  resolveActorUserId?: (workspaceId: string) => Promise<string | null>;
}

async function resolveTenancy(
  event: NormalizedInboundEvent,
  deps: CommsInboundIngestDeps,
): Promise<InboundTenancy | null> {
  const resolveSend =
    deps.resolveSend ??
    ((provider, msgId) => commsSendStore.findTenancyByProviderMessageId(provider, msgId));
  const resolveRoute =
    deps.resolveRoute ?? ((channel, address) => inboundRouteStore.resolve(channel, address));

  // Feedback about a prior send (delivery/bounce/complaint): correlate back to
  // the originating send FIRST so we recover its agent — only then fall back to
  // a bare tenant tag (agent unknown ⇒ no triage). Inbound messages skip this.
  if (event.kind === "delivery" || event.kind === "bounce" || event.kind === "complaint") {
    if (event.providerMessageId) {
      const send = await resolveSend(event.provider, event.providerMessageId);
      if (send) {
        return send;
      }
    }
    if (event.workspaceId) {
      return { workspaceId: event.workspaceId, agentId: event.agentId ?? null };
    }
  }

  // Inbound message → route by the address it arrived on (its owner's number).
  if (event.address) {
    const route = await resolveRoute(event.address.channel, event.address.value);
    if (route) {
      return { workspaceId: route.workspaceId, agentId: route.agentId };
    }
  }

  // Last resort: a tenant carried directly on the event.
  if (event.workspaceId) {
    return { workspaceId: event.workspaceId, agentId: event.agentId ?? null };
  }
  return null;
}

export function createCommsInboundIngest(deps: CommsInboundIngestDeps) {
  const onAct = deps.onAct ?? createWakeActDispatcher({ pool: deps.pool });
  const resolveActor =
    deps.resolveActorUserId ??
    ((workspaceId) => inboundRouteStore.resolveWorkspaceOwnerUserId(workspaceId));

  return async function ingest(
    event: NormalizedInboundEvent,
  ): Promise<CommsInboundIngestResult> {
    const tenancy = await resolveTenancy(event, deps);
    if (!tenancy) {
      return { status: "unrouted" };
    }

    // wake_events RLS is membership-gated → publish as a real workspace member.
    const actorUserId = await resolveActor(tenancy.workspaceId);
    if (!actorUserId) {
      return { status: "unrouted" };
    }

    // Short-circuit provider retries before re-triaging / re-dispatching.
    const existing = await findWakeEventByDedupeKey(deps.pool, {
      workspaceId: tenancy.workspaceId,
      userId: actorUserId,
      dedupeKey: event.dedupeKey,
    });
    if (existing) {
      return { status: "duplicate", wakeEventId: existing.id, decision: existing.decision };
    }

    const routeDeps: RouteEventDeps = {
      pool: deps.pool,
      onAct,
      triageInvoker: deps.triageInvoker,
    };
    const wake = await routeEvent(routeDeps, {
      workspaceId: tenancy.workspaceId,
      userId: actorUserId,
      candidateAgentId: tenancy.agentId,
      source: "webhook",
      sourceRef: event.provider,
      summary: event.summary,
      dedupeKey: event.dedupeKey,
      payload: {
        ...event.payload,
        kind: event.kind,
        commsSendId: tenancy.commsSendId ?? null,
        missionId: tenancy.missionId ?? null,
      },
    });

    return { status: "ok", wakeEventId: wake?.id, decision: wake?.decision };
  };
}

export type CommsInboundIngest = ReturnType<typeof createCommsInboundIngest>;
