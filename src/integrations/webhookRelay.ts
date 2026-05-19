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
 * DASH-51: backed by `webhook_subscriptions` + `webhook_relayed_events`
 * (migration 043). Pre-DASH-51 the entire relay lived in two in-memory
 * Maps — every Fly restart wiped registered relay URLs, so customer
 * webhooks 404'd until the user manually re-subscribed.
 */

import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

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
// In-memory caches (write-through to Postgres for durability)
// ---------------------------------------------------------------------------

const subscriptions = new Map<string, WebhookSubscription>();
/** Circular buffer — keeps the 500 most recent events per subscription */
const events = new Map<string, RelayedEvent[]>();
const MAX_EVENTS_PER_SUBSCRIPTION = 500;

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("webhookRelay requires DATABASE_URL outside development/test.");
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  integration_slug: string;
  trigger_id: string;
  event_types: string[] | string;
  workflow_template_id: string | null;
  label: string;
  active: boolean;
  signature_scheme: WebhookSignatureScheme;
  signing_secret: string | null;
  signature_header_key: string | null;
  last_fired_at: Date | string | null;
  created_at: Date | string;
}

interface EventRow {
  id: string;
  subscription_id: string;
  user_id: string;
  integration_slug: string;
  trigger_id: string;
  payload: Record<string, unknown> | string;
  headers: Record<string, string> | string;
  consumed: boolean;
  received_at: Date | string;
}

function parseJsonField<T>(value: T | string | null, fallback: T): T {
  if (value === null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value;
}

function isoOrUndefined(v: Date | string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

function mapSubscriptionRow(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    integrationSlug: row.integration_slug,
    triggerId: row.trigger_id,
    eventTypes: parseJsonField<string[]>(row.event_types, []),
    workflowTemplateId: row.workflow_template_id ?? undefined,
    label: row.label,
    active: row.active,
    createdAt: isoOrUndefined(row.created_at) ?? new Date().toISOString(),
    lastFiredAt: isoOrUndefined(row.last_fired_at),
    signatureScheme: row.signature_scheme,
    signingSecret: row.signing_secret ?? undefined,
    signatureHeaderKey: row.signature_header_key ?? undefined,
  };
}

function mapEventRow(row: EventRow): RelayedEvent {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    integrationSlug: row.integration_slug,
    triggerId: row.trigger_id,
    payload: parseJsonField<Record<string, unknown>>(row.payload, {}),
    headers: parseJsonField<Record<string, string>>(row.headers, {}),
    receivedAt: isoOrUndefined(row.received_at) ?? new Date().toISOString(),
    consumed: row.consumed,
  };
}

async function persistSubscription(sub: WebhookSubscription): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `INSERT INTO webhook_subscriptions (
       id, user_id, integration_slug, trigger_id, event_types, workflow_template_id,
       label, active, signature_scheme, signing_secret, signature_header_key,
       last_fired_at, created_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       event_types = EXCLUDED.event_types,
       workflow_template_id = EXCLUDED.workflow_template_id,
       label = EXCLUDED.label,
       active = EXCLUDED.active,
       signature_scheme = EXCLUDED.signature_scheme,
       signing_secret = EXCLUDED.signing_secret,
       signature_header_key = EXCLUDED.signature_header_key,
       last_fired_at = EXCLUDED.last_fired_at`,
    [
      sub.id,
      sub.userId,
      sub.integrationSlug,
      sub.triggerId,
      JSON.stringify(sub.eventTypes),
      sub.workflowTemplateId ?? null,
      sub.label,
      sub.active,
      sub.signatureScheme,
      sub.signingSecret ?? null,
      sub.signatureHeaderKey ?? null,
      sub.lastFiredAt ?? null,
      sub.createdAt,
    ],
  );
}

async function loadSubscriptionById(id: string): Promise<WebhookSubscription | undefined> {
  if (!postgresAvailable()) return undefined;
  const result = await getPostgresPool().query<SubscriptionRow>(
    `SELECT * FROM webhook_subscriptions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapSubscriptionRow(result.rows[0]) : undefined;
}

async function loadSubscriptionsByUser(userId: string): Promise<WebhookSubscription[]> {
  if (!postgresAvailable()) return [];
  const result = await getPostgresPool().query<SubscriptionRow>(
    `SELECT * FROM webhook_subscriptions WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map(mapSubscriptionRow);
}

async function deleteSubscriptionRow(id: string): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(`DELETE FROM webhook_subscriptions WHERE id = $1`, [id]);
}

async function persistEvent(event: RelayedEvent): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `INSERT INTO webhook_relayed_events (
       id, subscription_id, user_id, integration_slug, trigger_id,
       payload, headers, consumed, received_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
    [
      event.id,
      event.subscriptionId,
      event.userId,
      event.integrationSlug,
      event.triggerId,
      JSON.stringify(event.payload),
      JSON.stringify(event.headers),
      event.consumed,
      event.receivedAt,
    ],
  );
}

async function pruneSubscriptionEvents(subscriptionId: string): Promise<void> {
  // Keep only the MAX_EVENTS_PER_SUBSCRIPTION most recent events,
  // matching the in-memory circular-buffer behaviour.
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `DELETE FROM webhook_relayed_events
       WHERE subscription_id = $1
         AND id NOT IN (
           SELECT id FROM webhook_relayed_events
            WHERE subscription_id = $1
            ORDER BY received_at DESC
            LIMIT $2
         )`,
    [subscriptionId, MAX_EVENTS_PER_SUBSCRIPTION],
  );
}

async function loadEvents(subscriptionId: string): Promise<RelayedEvent[]> {
  if (!postgresAvailable()) return [];
  const result = await getPostgresPool().query<EventRow>(
    `SELECT * FROM webhook_relayed_events
      WHERE subscription_id = $1
      ORDER BY received_at DESC
      LIMIT $2`,
    [subscriptionId, MAX_EVENTS_PER_SUBSCRIPTION],
  );
  return result.rows.map(mapEventRow);
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

export const webhookRelay = {
  /** Register a new webhook trigger subscription. */
  async subscribe(params: {
    userId: string;
    integrationSlug: string;
    triggerId: string;
    eventTypes: string[];
    workflowTemplateId?: string;
    label: string;
    signatureScheme?: WebhookSignatureScheme;
    signingSecret?: string;
    signatureHeaderKey?: string;
  }): Promise<WebhookSubscription> {
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
    await persistSubscription(subscription);
    return subscription;
  },

  async listSubscriptions(
    userId: string,
    integrationSlug?: string,
  ): Promise<WebhookSubscription[]> {
    if (postgresAvailable()) {
      const persisted = await loadSubscriptionsByUser(userId);
      for (const sub of persisted) {
        subscriptions.set(sub.id, sub);
      }
      return persisted.filter(
        (s) => !integrationSlug || s.integrationSlug === integrationSlug,
      );
    }
    return Array.from(subscriptions.values()).filter(
      (s) =>
        s.userId === userId &&
        (!integrationSlug || s.integrationSlug === integrationSlug),
    );
  },

  async getSubscription(id: string): Promise<WebhookSubscription | undefined> {
    const cached = subscriptions.get(id);
    if (cached) return cached;
    const persisted = await loadSubscriptionById(id);
    if (persisted) subscriptions.set(persisted.id, persisted);
    return persisted;
  },

  /** Deactivate a subscription (soft delete — retains events). */
  async unsubscribe(id: string, userId: string): Promise<boolean> {
    const sub = subscriptions.get(id) ?? (await loadSubscriptionById(id));
    if (!sub || sub.userId !== userId) return false;
    const updated = { ...sub, active: false };
    subscriptions.set(id, updated);
    await persistSubscription(updated);
    return true;
  },

  /** Hard-delete a subscription and its events. */
  async deleteSubscription(id: string, userId: string): Promise<boolean> {
    const sub = subscriptions.get(id) ?? (await loadSubscriptionById(id));
    if (!sub || sub.userId !== userId) return false;
    subscriptions.delete(id);
    events.delete(id);
    await deleteSubscriptionRow(id);
    return true;
  },

  /**
   * Receive an inbound webhook payload for a subscription.
   * See module header for full contract.
   */
  async ingest(
    subscriptionId: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    rawBody: string = "",
  ): Promise<RelayedEvent | null> {
    const sub = subscriptions.get(subscriptionId) ?? (await loadSubscriptionById(subscriptionId));
    if (!sub || !sub.active) return null;

    if (sub.signatureScheme !== "none" && sub.signingSecret) {
      const valid = verifyWebhookSignature(
        sub.signatureScheme,
        sub.signingSecret,
        rawBody,
        headers,
        sub.signatureHeaderKey,
      );
      if (!valid) return null;
    }

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

    // Update in-memory buffer (cache for the in-process fast path)
    const buffer = events.get(subscriptionId) ?? [];
    buffer.push(event);
    if (buffer.length > MAX_EVENTS_PER_SUBSCRIPTION) {
      buffer.shift();
    }
    events.set(subscriptionId, buffer);

    const updatedSub = { ...sub, lastFiredAt: event.receivedAt };
    subscriptions.set(subscriptionId, updatedSub);

    await persistEvent(event);
    await persistSubscription(updatedSub);
    await pruneSubscriptionEvents(subscriptionId);

    return event;
  },

  /** List events for a subscription, most-recent first. */
  async listEvents(
    subscriptionId: string,
    userId: string,
    opts: { limit?: number; unconsumedOnly?: boolean } = {},
  ): Promise<RelayedEvent[]> {
    const sub = subscriptions.get(subscriptionId) ?? (await loadSubscriptionById(subscriptionId));
    if (!sub || sub.userId !== userId) return [];

    let buffer: RelayedEvent[];
    if (postgresAvailable()) {
      buffer = await loadEvents(subscriptionId);
    } else {
      buffer = (events.get(subscriptionId) ?? []).slice().reverse();
    }
    if (opts.unconsumedOnly) buffer = buffer.filter((e) => !e.consumed);
    if (opts.limit) buffer = buffer.slice(0, opts.limit);
    return buffer;
  },

  /** Mark events as consumed (after a workflow run is started). */
  async markConsumed(eventIds: string[], subscriptionId: string): Promise<void> {
    const buffer = events.get(subscriptionId);
    if (buffer) {
      const idSet = new Set(eventIds);
      const updated = buffer.map((e) => (idSet.has(e.id) ? { ...e, consumed: true } : e));
      events.set(subscriptionId, updated);
    }
    if (!postgresAvailable() || eventIds.length === 0) return;
    await getPostgresPool().query(
      `UPDATE webhook_relayed_events
          SET consumed = true
        WHERE subscription_id = $1 AND id = ANY($2::uuid[])`,
      [subscriptionId, eventIds],
    );
  },

  async clear(): Promise<void> {
    subscriptions.clear();
    events.clear();
    if (!postgresAvailable()) return;
    await getPostgresPool().query(`DELETE FROM webhook_relayed_events`);
    await getPostgresPool().query(`DELETE FROM webhook_subscriptions`);
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
