/**
 * Provider-event normalizers (HEL-613).
 *
 * Pure functions: provider webhook body → {@link NormalizedInboundEvent} (or
 * null when the body is irrelevant/unparseable). No I/O, no tenancy resolution
 * — that happens in ingest.ts. Unit-tested in isolation.
 */

import type { NormalizedInboundEvent } from "./types";

// ---------------------------------------------------------------------------
// Telnyx (SMS) — https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
//
// Webhook envelope: { data: { event_type, id, occurred_at, payload: {...} } }.
//  - Inbound SMS:        event_type = "message.received"
//  - Outbound DLR:       event_type = "message.sent" | "message.finalized" | …
//    payload.to[].status ∈ queued|sent|delivered|sending_failed|delivery_failed
// ---------------------------------------------------------------------------

interface TelnyxAddress {
  phone_number?: string;
  status?: string;
}
interface TelnyxPayload {
  id?: string;
  direction?: string;
  from?: TelnyxAddress;
  to?: TelnyxAddress[];
  text?: string;
}
interface TelnyxEnvelope {
  data?: {
    event_type?: string;
    id?: string;
    payload?: TelnyxPayload;
  };
}

const TELNYX_FAILED_STATUSES = new Set([
  "sending_failed",
  "delivery_failed",
  "failed",
  "expired",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normalize a Telnyx messaging webhook. Returns null for shapes we don't handle. */
export function normalizeTelnyxWebhook(body: unknown): NormalizedInboundEvent | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const data = (body as TelnyxEnvelope).data;
  const eventType = asString(data?.event_type);
  const payload = data?.payload;
  const eventId = asString(data?.id);
  const messageId = asString(payload?.id);
  if (!eventType || !payload || !eventId) {
    return null;
  }

  const from = asString(payload.from?.phone_number);
  const toNumber = asString(payload.to?.[0]?.phone_number);
  const base = {
    provider: "telnyx",
    dedupeKey: `telnyx:${eventId}`,
    payload: payload as unknown as Record<string, unknown>,
  };

  // Inbound SMS — route by the number it arrived on (our number → its owner).
  if (eventType === "message.received") {
    if (!toNumber) {
      return null;
    }
    const text = asString(payload.text) ?? "";
    return {
      ...base,
      kind: "inbound_sms",
      summary: `Inbound SMS from ${from ?? "unknown"} to ${toNumber}: ${text.slice(0, 240)}`,
      address: { channel: "sms", value: toNumber },
      providerMessageId: messageId,
    };
  }

  // Outbound delivery receipt — correlate back to the originating send.
  const status = asString(payload.to?.[0]?.status);
  const failed = status ? TELNYX_FAILED_STATUSES.has(status) : false;
  if (!messageId) {
    return null;
  }
  return {
    ...base,
    kind: failed ? "bounce" : "delivery",
    dedupeKey: `telnyx:${eventId}`,
    summary: failed
      ? `SMS to ${toNumber ?? "unknown"} failed (${status ?? "unknown"})`
      : `SMS to ${toNumber ?? "unknown"} ${status ?? "status update"}`,
    providerMessageId: messageId,
  };
}

// ---------------------------------------------------------------------------
// SES — the parsed SES notification (bounce / complaint / delivery). HEL-361's
// SES route owns suppression; this normalizer only turns the SAME event into a
// wake_event. Tenant comes from the outbound send's `mail.tags.workspace_id`.
// ---------------------------------------------------------------------------

export interface SesEventLike {
  notificationType?: string;
  eventType?: string;
  mail?: { messageId?: string; tags?: Record<string, string[]> };
  bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }> };
}

function workspaceIdFromSes(event: SesEventLike): string | null {
  const tag = event.mail?.tags?.workspace_id;
  return Array.isArray(tag) && tag.length > 0 ? tag[0] : null;
}

/** Normalize an SES bounce/complaint into a wake event. Returns null otherwise. */
export function normalizeSesEvent(event: SesEventLike): NormalizedInboundEvent | null {
  const type = event.notificationType ?? event.eventType;
  const messageId = asString(event.mail?.messageId);
  if (!type || !messageId) {
    return null;
  }
  const workspaceId = workspaceIdFromSes(event);

  if (type === "Bounce" && event.bounce?.bounceType === "Permanent") {
    const recipients = (event.bounce.bouncedRecipients ?? [])
      .map((r) => r.emailAddress)
      .filter((e): e is string => Boolean(e));
    return {
      provider: "ses",
      kind: "bounce",
      dedupeKey: `ses:bounce:${messageId}`,
      summary: `Email bounced (permanent) for ${recipients.join(", ") || "unknown recipient"}`,
      payload: { recipients, bounceType: event.bounce.bounceType, messageId },
      providerMessageId: messageId,
      workspaceId,
    };
  }

  if (type === "Complaint") {
    const recipients = (event.complaint?.complainedRecipients ?? [])
      .map((r) => r.emailAddress)
      .filter((e): e is string => Boolean(e));
    return {
      provider: "ses",
      kind: "complaint",
      dedupeKey: `ses:complaint:${messageId}`,
      summary: `Spam complaint from ${recipients.join(", ") || "unknown recipient"}`,
      payload: { recipients, messageId },
      providerMessageId: messageId,
      workspaceId,
    };
  }

  // Delivery / transient bounce → not a wake-worthy event for v1.
  return null;
}
