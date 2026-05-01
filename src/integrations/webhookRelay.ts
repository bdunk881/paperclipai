/**
 * Webhook Relay — receives inbound webhook payloads from third-party services
 * and routes them to registered workflow triggers.
 *
 * How it works:
 *   1. A user registers a trigger subscription (integrationSlug + triggerEventTypes + workflowTemplateId).
 *   2. AutoFlow gives the user a relay URL: POST /api/webhooks/relay/:subscriptionId
 *   3. The user configures this URL in the third-party service (e.g. GitHub, Stripe).
 *   4. When an event fires, the relay receives it, matches it to a subscription,
 *      and stores the event payload for immediate retrieval or async workflow execution.
 *
 * For production, replace the in-memory event buffer with a persistent queue
 * (e.g. Redis, SQS, PostgreSQL).
 */

import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

export type WebhookSignatureScheme =
  | "stripe"       // Stripe-Signature header: t=...,v1=<hmac-sha256>
  | "hubspot"      // X-HubSpot-Signature: hmac-sha256 of (clientSecret + body)
  | "github"       // X-Hub-Signature-256: sha256=<hmac-sha256>
  | "hmac-sha256"  // Generic: X-Signature-256 (or custom header) with hex HMAC-SHA256
  | "none";        // No signature verification

export interface WebhookSignatureConfig {
  scheme: WebhookSignatureScheme;
  /** The signing secret used to compute/verify the HMAC */
  signingSecret: string;
  /** For "hmac-sha256": override the header name (default: "x-signature-256") */
  signatureHeaderKey?: string;
}

/**
 * Verify the inbound webhook signature.
 * Returns true if verification passes (or scheme is "none").
 * Returns false if signature is missing or does not match.
 *
 * All comparisons use timingSafeEqual to prevent timing-based oracle attacks.
 */
export function verifyWebhookSignature(
  scheme: WebhookSignatureScheme,
  signingSecret: string,
  rawBody: string,
  headers: Record<string, string>,
  signatureHeaderKey?: string
): boolean {
  if (scheme === "none" || !signingSecret) return true;

  switch (scheme) {
    case "stripe": {
      // Stripe-Signature: t=<timestamp>,v1=<hmac>
      const sigHeader = headers["stripe-signature"];
      if (!sigHeader) return false;

      const parts: Record<string, string[]> = {};
      for (const part of sigHeader.split(",")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx === -1) continue;
        const k = part.slice(0, eqIdx).trim();
        const v = part.slice(eqIdx + 1).trim();
        (parts[k] ??= []).push(v);
      }

      const t = parts["t"]?.[0];
      const v1Sigs = parts["v1"] ?? [];
      if (!t || v1Sigs.length === 0) return false;

      const expectedPayload = `${t}.${rawBody}`;
      const expected = createHmac("sha256", signingSecret)
        .update(expectedPayload)
        .digest("hex");
      const expectedBuf = Buffer.from(expected);

      return v1Sigs.some((sig) => {
        if (sig.length !== expected.length) return false;
        return timingSafeEqual(expectedBuf, Buffer.from(sig));
      });
    }

    case "hubspot": {
      // X-HubSpot-Signature: sha256(clientSecret + requestBody)
      const sigHeader = headers["x-hubspot-signature"];
      if (!sigHeader) return false;
      const expected = createHmac("sha256", signingSecret)
        .update(rawBody)
        .digest("hex");
      if (sigHeader.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
    }

    case "github": {
      // X-Hub-Signature-256: sha256=<hex>
      const sigHeader = headers["x-hub-signature-256"];
      if (!sigHeader) return false;
      const prefix = "sha256=";
      if (!sigHeader.startsWith(prefix)) return false;
      const incoming = sigHeader.slice(prefix.length);
      const expected = createHmac("sha256", signingSecret)
        .update(rawBody)
        .digest("hex");
      if (incoming.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));
    }

    case "hmac-sha256": {
      const headerKey = (signatureHeaderKey ?? "x-signature-256").toLowerCase();
      const sigHeader = headers[headerKey];
      if (!sigHeader) return false;
      const expected = createHmac("sha256", signingSecret)
        .update(rawBody)
        .digest("hex");
      if (sigHeader.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
    }

    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A registered webhook trigger subscription. */
export interface WebhookSubscription {
  id: string;
  userId: string;
  integrationSlug: string;
  /** Trigger ID from the IntegrationManifest, e.g. "deal.created" */
  triggerId: string;
  /**
   * Event type strings to match against the incoming payload.
   * Matching strategy: checks common event-type fields in the payload
   * (type, event, eventType, action, topic) against any entry in this list.
   * Empty array = accept all events from this integration.
   */
  eventTypes: string[];
  /** Workflow template ID to run when this trigger fires (optional) */
  workflowTemplateId?: string;
  /** Human-readable label */
  label: string;
  active: boolean;
  createdAt: string;
  lastFiredAt?: string;
  /** Signature verification scheme (default: "none"). */
  signatureScheme: WebhookSignatureScheme;
  /** HMAC signing secret supplied by the third-party service (stored in memory only). */
  signingSecret?: string;
  /** Custom signature header key for "hmac-sha256" scheme. */
  signatureHeaderKey?: string;
}

/** A received webhook event stored in the relay buffer. */
export interface RelayedEvent {
  id: string;
  subscriptionId: string;
  userId: string;
  integrationSlug: string;
  triggerId: string;
  /** The raw inbound payload */
  payload: Record<string, unknown>;
  /** Headers from the inbound request (lowercased keys) */
  headers: Record<string, string>;
  receivedAt: string;
  /** Whether this event has been consumed by a workflow run */
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// In-memory relay state
// ---------------------------------------------------------------------------

const subscriptions = new Map<string, WebhookSubscription>();
/** Circular buffer — keeps the 500 most recent events per subscription */
const events = new Map<string, RelayedEvent[]>();
const MAX_EVENTS_PER_SUBSCRIPTION = 500;

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

export const webhookRelay = {
  /** Register a new webhook trigger subscription. Returns the subscription record. */
  subscribe(params: {
    userId: string;
    integrationSlug: string;
    triggerId: string;
    eventTypes: string[];
    workflowTemplateId?: string;
    label: string;
    signatureScheme?: WebhookSignatureScheme;
    signingSecret?: string;
    signatureHeaderKey?: string;
  }): WebhookSubscription {
    const subscription: WebhookSubscription = {
      id: randomUUID(),
      userId: params.userId,
      integrationSlug: params.integrationSlug,
      triggerId: params.triggerId,
      eventTypes: params.eventTypes,
      workflowTemplateId: params.workflowTemplateId,
      label: params.label,
      active: true,
      createdAt: new Date().toISOString(),
      signatureScheme: params.signatureScheme ?? "none",
      signingSecret: params.signingSecret,
      signatureHeaderKey: params.signatureHeaderKey,
    };
    subscriptions.set(subscription.id, subscription);
    events.set(subscription.id, []);
    return subscription;
  },

  /** List subscriptions for a user (optionally filtered by integration). */
  listSubscriptions(userId: string, integrationSlug?: string): WebhookSubscription[] {
    return Array.from(subscriptions.values()).filter(
      (s) =>
        s.userId === userId &&
        (!integrationSlug || s.integrationSlug === integrationSlug)
    );
  },

  /** Get a subscription by ID. */
  getSubscription(id: string): WebhookSubscription | undefined {
    return subscriptions.get(id);
  },

  /** Deactivate a subscription (soft delete — retains events). */
  unsubscribe(id: string, userId: string): boolean {
    const sub = subscriptions.get(id);
    if (!sub || sub.userId !== userId) return false;
    subscriptions.set(id, { ...sub, active: false });
    return true;
  },

  /** Hard-delete a subscription and its events. */
  deleteSubscription(id: string, userId: string): boolean {
    const sub = subscriptions.get(id);
    if (!sub || sub.userId !== userId) return false;
    subscriptions.delete(id);
    events.delete(id);
    return true;
  },

  // ---------------------------------------------------------------------------
  // Event ingestion
  // ---------------------------------------------------------------------------

  /**
   * Receive an inbound webhook payload for a subscription.
   *
   * - Validates the subscription is active.
   * - Verifies the webhook signature when signatureScheme is not "none".
   * - Optionally matches event type against subscription.eventTypes.
   * - Stores the event in the relay buffer.
   * - Returns the stored event (callers can use this to fire workflow runs).
   *
   * Returns null if the subscription is not found, inactive, signature invalid,
   * or event type not matched.
   *
   * @param rawBody  The raw request body string, required for signature verification.
   *                 Pass an empty string ("") when the subscription uses scheme "none".
   */
  ingest(
    subscriptionId: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    rawBody: string = ""
  ): RelayedEvent | null {
    const sub = subscriptions.get(subscriptionId);
    if (!sub || !sub.active) return null;

    // Signature verification — reject if scheme is configured and sig is bad
    if (sub.signatureScheme !== "none" && sub.signingSecret) {
      const valid = verifyWebhookSignature(
        sub.signatureScheme,
        sub.signingSecret,
        rawBody,
        headers,
        sub.signatureHeaderKey
      );
      if (!valid) return null;
    }

    // Match event type when the subscription filters by eventTypes
    if (sub.eventTypes.length > 0) {
      const incomingType = resolveEventType(payload, headers);
      if (incomingType && !sub.eventTypes.includes(incomingType)) {
        return null;
      }
    }

    const event: RelayedEvent = {
      id: randomUUID(),
      subscriptionId,
      userId: sub.userId,
      integrationSlug: sub.integrationSlug,
      triggerId: sub.triggerId,
      payload,
      headers,
      receivedAt: new Date().toISOString(),
      consumed: false,
    };

    // Append to buffer, respecting max size
    const buffer = events.get(subscriptionId) ?? [];
    buffer.push(event);
    if (buffer.length > MAX_EVENTS_PER_SUBSCRIPTION) {
      buffer.shift(); // remove oldest
    }
    events.set(subscriptionId, buffer);

    // Update lastFiredAt
    subscriptions.set(subscriptionId, { ...sub, lastFiredAt: event.receivedAt });

    return event;
  },

  // ---------------------------------------------------------------------------
  // Event retrieval
  // ---------------------------------------------------------------------------

  /** List events for a subscription, most-recent first. */
  listEvents(
    subscriptionId: string,
    userId: string,
    opts: { limit?: number; unconsumedOnly?: boolean } = {}
  ): RelayedEvent[] {
    const sub = subscriptions.get(subscriptionId);
    if (!sub || sub.userId !== userId) return [];

    let buffer = (events.get(subscriptionId) ?? []).slice().reverse();
    if (opts.unconsumedOnly) buffer = buffer.filter((e) => !e.consumed);
    if (opts.limit) buffer = buffer.slice(0, opts.limit);
    return buffer;
  },

  /** Mark events as consumed (after a workflow run is started). */
  markConsumed(eventIds: string[], subscriptionId: string): void {
    const buffer = events.get(subscriptionId);
    if (!buffer) return;
    const idSet = new Set(eventIds);
    const updated = buffer.map((e) => (idSet.has(e.id) ? { ...e, consumed: true } : e));
    events.set(subscriptionId, updated);
  },

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  clear(): void {
    subscriptions.clear();
    events.clear();
  },
};

// ---------------------------------------------------------------------------
// Event type resolution
// ---------------------------------------------------------------------------

/**
 * Attempt to determine the event type from a webhook payload.
 * Different services use different field names:
 *   GitHub     → payload.action or X-GitHub-Event header
 *   Stripe     → payload.type
 *   Slack      → payload.event.type
 *   HubSpot    → payload[0].subscriptionType (array body)
 *   Generic    → payload.eventType, payload.event, payload.topic
 */
function resolveEventType(
  payload: Record<string, unknown>,
  headers: Record<string, string>
): string | null {
  // Check common headers first
  const headerEvent = headers["x-github-event"] ?? headers["x-event-type"];
  if (headerEvent) return headerEvent;

  // Stripe / generic
  if (typeof payload["type"] === "string") return payload["type"];
  if (typeof payload["eventType"] === "string") return payload["eventType"];
  if (typeof payload["event"] === "string") return payload["event"];
  if (typeof payload["topic"] === "string") return payload["topic"];
  if (typeof payload["action"] === "string") return payload["action"];

  // Slack event wrapper
  const slackEvent = payload["event"];
  if (slackEvent && typeof slackEvent === "object" && "type" in (slackEvent as object)) {
    return (slackEvent as { type: string }).type;
  }

  // HubSpot array body
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as Record<string, unknown>;
    if (typeof first["subscriptionType"] === "string") return first["subscriptionType"];
  }

  return null;
}
