/**
 * Composio inbound webhook handler (HEL-749 / P1d).
 *
 * Verifies the signature via the SDK (`composio.triggers.verifyWebhook`) and, on
 * a `connected_account.expired` event, marks the local connected-account row
 * EXPIRED so the dashboard surfaces it for re-auth.
 *
 * The webhook has no session, so we recover the row's workspace via the
 * system-context store lookup, then flip status under that workspace context.
 *
 * IMPORTANT (SDK quirk): `connected_account.expired` is a lifecycle event, not a
 * trigger, so the SDK normalizer takes its fallback branch — the real ca_ /
 * toolkit / status live in `result.payload.payload` (the raw `data`), and the
 * event type is in `result.payload.triggerSlug`. `metadata.connectedAccount` is
 * empty for this event, so do not read it.
 */

import { isComposioEnabled, composioUserId, workspaceIdFromComposioUserId } from "./config";
import { getComposioBroker } from "./client";
import { connectedAccountStore } from "./connectedAccountStore";
import { getPostgresPool } from "../../../db/postgres";
import { createComposioTriggerIngest, type ComposioTriggerIngest } from "./composioTriggerIngest";

const EXPIRED_EVENT = "composio.connected_account.expired";

export interface ComposioWebhookHeaders {
  /** `webhook-id` header */
  id?: string;
  /** `webhook-timestamp` header (Unix seconds) */
  timestamp?: string;
  /** `webhook-signature` header ("v1,<base64>") */
  signature?: string;
}

export interface ComposioWebhookOutcome {
  status: number;
  body: { received: boolean; handled?: string; error?: string };
}

export interface HandleComposioWebhookDeps {
  /**
   * Injectable trigger ingest (for tests). Default:
   * createComposioTriggerIngest({ pool: getPostgresPool() }), constructed lazily
   * only when a real trigger event arrives (so EXPIRED-only deployments and unit
   * tests never touch the pool).
   */
  triggerIngest?: ComposioTriggerIngest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Handle a raw inbound Composio webhook. Returns the HTTP status + body the route
 * should send. Signature failures → 401; unconfigured → 503; everything else
 * (unknown event, unknown account) is acked 200 so Composio doesn't retry.
 */
export async function handleComposioWebhook(
  rawBody: string,
  headers: ComposioWebhookHeaders,
  deps?: HandleComposioWebhookDeps,
): Promise<ComposioWebhookOutcome> {
  if (!isComposioEnabled()) {
    return { status: 503, body: { received: false, error: "Composio is not enabled." } };
  }
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return {
      status: 503,
      body: { received: false, error: "COMPOSIO_WEBHOOK_SECRET is not configured." },
    };
  }

  const composio = await getComposioBroker();

  let result;
  try {
    result = await composio.triggers.verifyWebhook({
      id: headers.id ?? "",
      timestamp: headers.timestamp ?? "",
      signature: headers.signature ?? "",
      payload: rawBody,
      secret,
    });
  } catch {
    return { status: 401, body: { received: false, error: "Invalid webhook signature." } };
  }

  const triggerSlug = result.payload.triggerSlug;

  // ---- connected_account.expired (P1d): mark the local row for re-auth -------
  if (triggerSlug === EXPIRED_EVENT) {
    // The real account data is the raw event `data` (payload.payload), not metadata.
    const data = isRecord(result.payload.payload) ? result.payload.payload : {};
    const caId = typeof data.id === "string" ? data.id.trim() : "";
    if (!caId) {
      return { status: 200, body: { received: true, handled: "missing-account-id" } };
    }

    const row = await connectedAccountStore.findByConnectedAccountId(caId);
    if (!row) {
      // Unknown / foreign ca_ — ack so Composio stops retrying.
      return { status: 200, body: { received: true, handled: "unknown-account" } };
    }

    await connectedAccountStore.markStatus(
      { workspaceId: row.workspaceId, userId: "composio-webhook" },
      caId,
      "EXPIRED",
    );

    // Best-effort re-auth signal. Wiring this to the notification / connection-health
    // UX is a follow-up; for now it's a structured log keyed by the broker userId.
    const reason = typeof data.status_reason === "string" ? `: ${data.status_reason}` : "";
    console.warn(
      `[composio] connected account ${caId} (${row.toolkit}, ${composioUserId(row.workspaceId)}) ` +
        `expired — re-auth needed${reason}`,
    );

    return { status: 200, body: { received: true, handled: "expired" } };
  }

  // ---- trigger event (P4-b): route into the wake/triage engine --------------
  // A real trigger self-identifies its tenancy via userId = ws_<workspaceId> (the
  // V3 normalizer path). Other lifecycle events take the fallback branch and have
  // no parseable userId, so they fall through to "ignored".
  const workspaceId = workspaceIdFromComposioUserId(result.payload.userId);
  if (workspaceId) {
    const ingest = deps?.triggerIngest ?? createComposioTriggerIngest({ pool: getPostgresPool() });
    const outcome = await ingest({
      workspaceId,
      triggerSlug,
      connectedAccountId: result.payload.metadata.connectedAccount.id,
      eventId: result.payload.id,
      payload: isRecord(result.payload.payload) ? result.payload.payload : {},
    });
    return { status: 200, body: { received: true, handled: `trigger:${outcome.status}` } };
  }

  return { status: 200, body: { received: true, handled: "ignored" } };
}
