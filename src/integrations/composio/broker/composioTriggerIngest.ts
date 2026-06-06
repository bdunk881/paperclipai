/**
 * Composio trigger ingest (HEL-766 / P4-b).
 *
 * Turns a verified inbound Composio TRIGGER event into an agent run via the
 * existing wake/triage engine — the unified dispatch seam (NOT the dead
 * routines.trigger_kind enum). Modeled on src/comms/webhooks/ingest.ts (HEL-613),
 * but tenancy comes from the event's userId (= ws_<workspaceId>) + the stored
 * trigger instance binding, not an inbound address.
 *
 * Flow: resolve the bound trigger instance (slug + connected account → workspace
 * + agent) → resolve a member user for the membership-gated wake_events RLS →
 * dedupe provider retries → routeEvent(source:"composio_trigger"). The default
 * triage policy ACTs on that source (triagePolicy.ts), so a subscribed trigger
 * actually wakes its agent.
 */

import type { Pool } from "pg";
import { routeEvent, type RouteEventDeps } from "../../../agents/eventRouter";
import { createWakeActDispatcher } from "../../../agents/wakeDispatch";
import type { TriageInvoker } from "../../../agents/triagePolicy";
import {
  findWakeEventByDedupeKey,
  type WakeDecision,
  type WakeEvent,
} from "../../../agents/wakeEventStore";
import { getPostgresPool, inMemoryAllowed, isPostgresConfigured } from "../../../db/postgres";
import { triggerInstanceStore } from "./triggerInstanceStore";

/** A verified trigger event, normalized off the SDK's IncomingTriggerPayload (P4-b webhook). */
export interface NormalizedComposioTriggerEvent {
  /** Workspace derived from the event's userId (= ws_<id>). */
  workspaceId: string;
  /** Trigger type slug, e.g. "GITHUB_COMMIT_EVENT". */
  triggerSlug: string;
  /** The connected account (ca_) the trigger fired on. */
  connectedAccountId: string;
  /** Unique per-firing event id — the wake dedupe key (retries carry the same id). */
  eventId: string;
  /** The event data the trigger delivered. */
  payload: Record<string, unknown>;
}

export interface ComposioTriggerIngestResult {
  status: "ok" | "duplicate" | "unrouted";
  wakeEventId?: string;
  decision?: WakeDecision;
}

interface ResolvedInstance {
  workspaceId: string;
  agentId: string;
  status: string;
}

export interface ComposioTriggerIngestDeps {
  pool: Pool;
  triageInvoker?: TriageInvoker;
  /** ACT dispatcher (onAct). Default: createWakeActDispatcher({ pool }). */
  onAct?: (event: WakeEvent) => Promise<void>;
  /** Resolve a fired event → its bound trigger instance. Default: triggerInstanceStore. */
  resolveInstance?: (
    triggerSlug: string,
    connectedAccountId: string,
  ) => Promise<ResolvedInstance | null>;
  /** Resolve the RLS actor (a workspace member). Default: app_resolve_workspace_owner. */
  resolveActorUserId?: (workspaceId: string) => Promise<string | null>;
}

/** Default actor resolver — the workspace owner via the SECURITY DEFINER fn (migration 109). */
async function defaultResolveActor(workspaceId: string): Promise<string | null> {
  if (!isPostgresConfigured()) {
    // Dev/test without Postgres: no real members → unrouted (mirrors comms ingest).
    if (inMemoryAllowed()) return null;
    throw new Error("composioTriggerIngest requires DATABASE_URL outside development/test.");
  }
  const res = await getPostgresPool().query<{ owner: string | null }>(
    `SELECT app_resolve_workspace_owner($1) AS owner`,
    [workspaceId],
  );
  return res.rows[0]?.owner ?? null;
}

export function createComposioTriggerIngest(deps: ComposioTriggerIngestDeps) {
  const onAct = deps.onAct ?? createWakeActDispatcher({ pool: deps.pool });
  const resolveInstance =
    deps.resolveInstance ??
    (async (slug, ca) => {
      const row = await triggerInstanceStore.findBySlugAndConnectedAccount(slug, ca);
      return row ? { workspaceId: row.workspaceId, agentId: row.agentId, status: row.status } : null;
    });
  const resolveActor = deps.resolveActorUserId ?? defaultResolveActor;

  return async function ingest(
    event: NormalizedComposioTriggerEvent,
  ): Promise<ComposioTriggerIngestResult> {
    const instance = await resolveInstance(event.triggerSlug, event.connectedAccountId);
    // Unknown / disabled / cross-workspace mismatch (the event's userId must agree
    // with the stored binding's workspace) → drop (acked 200 by the webhook).
    if (
      !instance ||
      instance.status !== "ENABLED" ||
      instance.workspaceId !== event.workspaceId
    ) {
      return { status: "unrouted" };
    }

    // wake_events RLS is membership-gated → publish as a real workspace member.
    const actorUserId = await resolveActor(event.workspaceId);
    if (!actorUserId) {
      return { status: "unrouted" };
    }

    // Short-circuit provider retries before re-triaging / re-dispatching.
    const existing = await findWakeEventByDedupeKey(deps.pool, {
      workspaceId: event.workspaceId,
      userId: actorUserId,
      dedupeKey: event.eventId,
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
      workspaceId: event.workspaceId,
      userId: actorUserId,
      candidateAgentId: instance.agentId,
      source: "composio_trigger",
      sourceRef: "composio",
      summary: `Composio trigger ${event.triggerSlug} fired`,
      dedupeKey: event.eventId,
      payload: {
        ...event.payload,
        triggerSlug: event.triggerSlug,
        connectedAccountId: event.connectedAccountId,
      },
    });

    return { status: "ok", wakeEventId: wake?.id, decision: wake?.decision };
  };
}

export type ComposioTriggerIngest = ReturnType<typeof createComposioTriggerIngest>;
