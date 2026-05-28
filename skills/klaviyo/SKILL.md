---
name: klaviyo
description: Use this skill when an AutoFlow agent needs to manage e-commerce-focused email + SMS marketing in Klaviyo — sync profiles from Shopify or HubSpot, track behavioral events (viewed product, added to cart, purchased), trigger flows, manage segments, react to flow / campaign lifecycle webhooks. Covers Klaviyo's v2024-10-15 REST API, the private-key auth model, the Profile / Event / Flow / List / Segment / Catalog model, and the workflow shape AutoFlow customers reach for (Shopify purchase → event + tag, abandoned cart → flow trigger, browse → personalization signal).
---

# Klaviyo — e-commerce email + SMS marketing

Klaviyo is the most common email + SMS marketing platform for AutoFlow's Shopify-anchored customer base. It out-converts Mailchimp on e-commerce because its segmentation engine is built around shopping behavior — abandoned-cart, browse-but-no-buy, post-purchase upsell, win-back inactive — and it natively ingests Shopify events.

Use Klaviyo *instead of* Mailchimp for customers selling physical or digital goods through Shopify, BigCommerce, or WooCommerce. Use Mailchimp for service / B2B SMBs where the behavioral graph doesn't matter as much.

## When to reach for this skill

- **Shopify purchase / cart / browse event** → push to Klaviyo as a behavioral event for segmentation + flow triggering.
- **Lead capture** (Calendly booking, HubSpot form) → upsert profile, add to a list, optionally trigger an entry flow.
- **Flow / campaign metric** → log opens/clicks/bounces/unsubs for reporting.
- **Predictive analytics** — read Klaviyo's churn-probability + lifetime-value scores into AutoFlow routines.
- **Win-back routine** — identify profiles inactive >90d, target with reactivation email.

## Authentication

Klaviyo uses **Private API Keys** (start with `pk_`) for server-side access:

```
Authorization: Klaviyo-API-Key <klaviyo-private-key>
revision: 2024-10-15
```

`revision` header pins the API version — **always set it**. Klaviyo deprecates old revisions roughly annually; pinning to a known version (currently `2024-10-15`) is the only way to avoid surprise breakages.

For multi-tenant SaaS apps, OAuth 2 is supported via Klaviyo's `/oauth/authorize` flow. AutoFlow's `ticketSync` schema (`src/ticketSync/`) handles both `api_key` and `oauth2_pkce`.

Public keys (`pk_pub_*`) exist for client-side tracking (web pixel, mobile SDK) and have limited write permission. Don't confuse them with private keys.

Base URL: `https://a.klaviyo.com/api/`

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Profile | `/profiles/{id}` | The subscriber record |
| Profile Upsert | `/profile-import` | Idempotent upsert by email or external_id |
| Event | `/events` | Behavioral event for segmentation triggering |
| List | `/lists/{id}` | Subscriber list (different from segments) |
| Segment | `/segments/{id}` | Dynamic query — auto-computed membership |
| Flow | `/flows/{id}` | Automated multi-step sequence |
| Campaign | `/campaigns/{id}` | One-off broadcast send |
| Catalog Item | `/catalog-items/{id}` | Product record for personalization |
| Metric | `/metrics/{id}` | Behavior type (e.g. "Placed Order") |
| Coupon | `/coupons/{id}` | Discount code for personalization |

## Common AutoFlow workflows

### 1. Shopify purchase → Klaviyo event + segment tagging

```
Shopify orders/paid webhook → Routine fires →
  1. POST /profile-import with order.email + customer details
     (idempotent — upserts on email or external_id)
  2. POST /events with the Klaviyo metric "Placed Order":
       attributes:
         profile: { email }
         metric: { name: "Placed Order" }
         properties:
           order_id, total, currency, items: [{ product_id, qty, price }]
       (This is the magic event — Klaviyo's "Post-Purchase Flow" auto-fires
        based on its presence.)
  3. Optional: POST a "Viewed Product" or "Added to Cart" event from
     Shopify's abandoned-cart data for retargeting flows.
```

### 2. Abandoned cart → flow trigger

```
Shopify checkouts/create webhook (with no orders/paid within N min) →
Routine fires →
  1. POST /profile-import for checkout.email (Shopify exposes email on
     the checkout object even without conversion)
  2. POST /events "Started Checkout":
       properties: { checkout_url, cart_value, items[] }
  3. Klaviyo's "Abandoned Checkout Flow" (configured in Klaviyo UI by
     the customer's marketer) fires the recovery sequence.
     AutoFlow doesn't need to chase further.
```

### 3. Cross-channel routine — Klaviyo flow → HubSpot lifecycle

```
Klaviyo flow event "Customer Won Back" via webhook → Routine fires →
  1. Verify webhook signature
  2. HubSpot PATCH /crm/v3/objects/contacts/{email}?idProperty=email
       set lifecyclestage=customer
       set custom property reactivation_campaign=<flow_name>
  3. Optional: post a Slack alert to #sales — high-value reactivations
     deserve human follow-up.
```

### 4. Predictive churn → outreach routine

```
Cron routine weekly →
  1. GET /segments — find the "Churn Risk" segment ID (configured in UI)
  2. GET /segments/{id}/profiles?page[size]=100&include=profile (paginate)
  3. For each high-risk profile:
       Look up HubSpot contact, check if there's an open conversation
       in Intercom or Zendesk; if yes, skip (already being handled)
       Otherwise, fire a personal-outreach Klaviyo flow OR queue a
       CSM Slack task.
```

### 5. Coupon-driven flow personalization

```
On any flow that needs to send a unique discount code:
  1. POST /coupons (or use a pre-generated batch) to create per-recipient codes
  2. Klaviyo's flow template references the coupon via merge tags
  3. After send, ingest redemption events from Shopify back to Klaviyo
     via /events "Used Promotion" for measurement.
```

## Idempotency

- **Profile upsert** is naturally idempotent on `email` or `external_id` — use the `/profile-import` endpoint, not the older `/profiles` POST.
- **Events** are NOT deduplicated — Klaviyo records every event call as a separate timeline entry. AutoFlow routines must check-before-send (or accept double-counting) for events that mustn't double-fire. Set a unique `event_unique_id` in the event payload (Klaviyo recently added support) as the dedupe key.

## Segments vs Lists

- **List** = static or manually-added subscribers. Like an email distribution group.
- **Segment** = dynamic query over profiles + events. Like a saved search. Membership recomputes continuously.

For AutoFlow routines, **read from segments** (they reflect current state); **write to lists** (you can append; you can't append to a segment).

## Webhooks

Manage subscriptions in Klaviyo's UI (under Account → Integrations → API Webhooks) or via API:

```
POST /webhooks
body:
  webhook:
    name: "AutoFlow workspace {workspace_id}"
    endpoint_url: "https://autoflow.example/webhooks/klaviyo/{workspace_id}"
    enabled_events: ["profile.subscribed_to_list", "profile.unsubscribed_from_list", "metric.created"]
```

Signature verification: `Klaviyo-Webhook-Signature` is an HMAC-SHA256 of the body using the secret returned at subscription-creation time. **Verify before processing.**

Replay safety: dedupe by the `id` field at the top of the webhook payload (each event has a stable UUID).

## Rate limits

Klaviyo has **per-endpoint rate limits** rather than account-wide:
- `/events` POST: 350/sec burst, 3500/min steady
- `/profiles` POST/PATCH: 75/sec burst, 700/min steady
- Most read endpoints: 75/sec burst, 700/min steady

429 returns `Retry-After`. Bulk operations have dedicated higher-throughput endpoints (`/profile-bulk-import-jobs`, `/event-bulk-create-jobs`) — use them for >1,000 records.

## What this skill does NOT cover

- **Klaviyo SMS** (separate from email but same API) — endpoints are shared; if a customer enables SMS the same `Channels` concept applies.
- **Klaviyo Reviews** (their newer reviews/social-proof product) — separate API surface.
- **Mobile push** via Klaviyo SDK — embedded into the customer's app, not driven from AutoFlow.
- **Mailchimp** — covered by its own skill. Customers usually pick one or the other; don't drive both for the same audience.

## References

- API: https://developers.klaviyo.com/en/reference/api_overview
- API versioning: https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy
- Webhooks: https://developers.klaviyo.com/en/docs/webhooks
- Events vs Metrics: https://developers.klaviyo.com/en/docs/guide_to_using_metric_objects
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce; private key stored in secrets store)
