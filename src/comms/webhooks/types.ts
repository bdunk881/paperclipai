/**
 * Inbound comms webhook types (HEL-613).
 *
 * Provider webhooks (Telnyx SMS, SES/SNS notifications, …) are normalized into
 * a single {@link NormalizedInboundEvent} shape, then resolved to a tenant and
 * published to `wake_events` → triage. Keeping the normalized shape provider-
 * agnostic means the ingest + routing logic is written once.
 */

import type { CommsChannel } from "../types";

/** What kind of inbound/feedback event this is. */
export type CommsInboundKind =
  | "inbound_sms"
  | "reply"
  | "delivery"
  | "bounce"
  | "complaint";

/**
 * A provider event normalized for the wake/triage layer, plus the hints used to
 * resolve which tenant/agent it belongs to. Exactly one resolution hint applies
 * per kind:
 *  - `inbound_sms` / `reply` → {@link address} (route by the number/address it
 *    arrived on).
 *  - `delivery` / `bounce` / `complaint` → {@link providerMessageId} (correlate
 *    back to the originating send) OR {@link workspaceId} when the provider
 *    carried the tenant tag (SES `mail.tags.workspace_id`).
 */
export interface NormalizedInboundEvent {
  /** Provider slug: 'telnyx' | 'ses' | … (becomes the wake_event source_ref). */
  provider: string;
  kind: CommsInboundKind;
  /** Stable per-provider-event id; dedupes webhook retries (wake_events.dedupe_key). */
  dedupeKey: string;
  /** Human one-liner the triage layer reads. */
  summary: string;
  /** Structured event body. Caller's responsibility to keep PII sane. */
  payload: Record<string, unknown>;
  /** Inbound message → route by the address it arrived on. */
  address?: { channel: CommsChannel; value: string };
  /** Delivery/bounce → correlate back to the originating send. */
  providerMessageId?: string;
  /** Tenant carried in the provider payload (e.g. SES mail.tags.workspace_id). */
  workspaceId?: string | null;
  /** Agent carried in the provider payload, if any. */
  agentId?: string | null;
}

/** Resolved owner of an inbound event. */
export interface InboundTenancy {
  workspaceId: string;
  agentId: string | null;
  missionId?: string | null;
  commsSendId?: string | null;
}
