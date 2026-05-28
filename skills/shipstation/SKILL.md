---
name: shipstation
description: Use this skill when an AutoFlow agent needs to create or query shipping labels and fulfillments in ShipStation — pull pending orders from connected stores, create shipments, generate labels, fire tracking webhooks back to the customer or CRM, push fulfillment status to Shopify or QuickBooks. Covers ShipStation v1 + v2 REST APIs, the Basic Auth + API key models (different per API version), Order / Shipment / Carrier / Warehouse model, and the workflow shape AutoFlow customers reach for (Shopify order → label, label printed → customer email + CRM update, return → restock + refund).
---

# ShipStation — order fulfillment & shipping labels

ShipStation is the most common shipping/fulfillment platform for AutoFlow's SMB e-commerce segment. It aggregates orders from multiple stores (Shopify, Amazon, eBay, WooCommerce) and turns them into printable labels across multiple carriers (USPS, UPS, FedEx, DHL).

## When to reach for this skill

- **New Shopify order** → import into ShipStation, auto-create a shipment, generate a label.
- **Label printed** → email tracking to the customer, update Shopify fulfillment status, push tracking number to HubSpot deal / Stripe receipt.
- **Multi-warehouse routing** → pick the cheapest warehouse + carrier combination for a given destination.
- **Return / RMA** → create a return label, queue restocking, fire refund routine in Stripe.
- **Daily shipment recap** → post a Slack summary of shipped/pending/exceptioned orders.

## Authentication

ShipStation has **two API generations** with different auth models — know which you're talking to:

- **v1 (`ssapi.shipstation.com`)** — legacy but still the only place some features live (orders import, custom store integrations). Auth is **Basic Auth** with `API Key:API Secret`:

  ```
  Authorization: Basic base64(<api-key>:<api-secret>)
  ```

- **v2 (`api.shipengine.com`)** — the modern API (ShipStation acquired ShipEngine and unified branding). Auth is a single header:

  ```
  API-Key: <shipstation-api-key>
  ```

Default to **v2** for new integrations (label creation, rate shopping, tracking). Fall back to **v1** when v2 doesn't have the endpoint yet (notably: native Shopify store importing happens at the v1 store layer).

AutoFlow's connection record should store both creds when present and a flag for which API version a given customer's flow uses.

## Core API surface

### v2 (`https://api.shipengine.com/v1/`)

| Resource | Endpoint | What it's for |
|---|---|---|
| Carrier | `/carriers` | Connected carriers + their service codes |
| Shipment | `/shipments` | The container for label generation |
| Rate | `/rates` | Get carrier+service quotes for a shipment |
| Label | `/labels` | Purchase + render a printable label |
| Tracking | `/tracking?carrier_code=...&tracking_number=...` | Status, events, delivery date |
| Address Validation | `/addresses/validate` | USPS-recommended cleanup before label purchase |
| Webhook | `/environment/webhooks` | Manage push-event subscriptions |

### v1 (`https://ssapi.shipstation.com/`)

| Resource | Endpoint | What it's for |
|---|---|---|
| Stores | `/stores` | Connected sales channels (Shopify, Amazon, etc.) |
| Orders | `/orders` | Imported orders from all stores |
| Shipments | `/shipments` | v1 shipment record (separate from v2) |
| Tags | `/accounts/listtags` | Workflow labels for filtering/automation |
| Mark As Shipped | `/orders/markasshipped` | Manually flag an order as fulfilled |

## Common AutoFlow workflows

### 1. Shopify order → label + customer tracking email

```
Shopify orders/create webhook → Routine fires →
  1. ShipStation v1 already auto-imports from connected Shopify stores
     (verify with GET /orders?orderNumber=...)
  2. POST v2 /rates to find cheapest service for the destination + weight
  3. POST v2 /labels with the chosen rate_id
     (returns label_download.pdf URL + tracking_number)
  4. POST v1 /orders/markasshipped with the tracking number
     (this triggers Shopify's "Order Shipped" email natively)
  5. POST HubSpot timeline event on the contact: "Shipped via {carrier}"
```

### 2. Daily multi-warehouse rate shopping

```
Cron routine every 30min during business hours →
  1. GET v1 /orders?orderStatus=awaiting_shipment&pageSize=100
  2. For each order, POST v2 /rates with all warehouse origins
  3. Pick the cheapest by total (rate + fuel + insurance)
  4. POST v2 /labels with origin = winning warehouse
  5. Print to the warehouse's pre-configured printer via Print Node or
     similar bridge (handled outside ShipStation API).
```

### 3. Return / RMA → restock + Stripe refund

```
Customer support routine: "I'd like to return order #1234" →
  1. POST v2 /labels with is_return_label=true + the original
     ship_to/ship_from inverted; returns a downloadable return label
  2. Email the label to the customer
  3. On warehouse-side scan of inbound (handled by inventory system),
     fire Stripe refund routine (see stripe-payments skill)
  4. Shopify PATCH to restock the variants
  5. Tag the HubSpot contact with "returned-item" for cohort analysis.
```

### 4. Daily shipment recap → Slack

```
Cron routine at 5pm local →
  1. GET v1 /shipments?shipDate={today}&pageSize=500 (paginate)
  2. Aggregate: total shipped, by carrier, by warehouse, exceptions
  3. POST to the workspace's #ops Slack channel:
       "Today: 247 shipments • 178 USPS, 52 UPS, 17 FedEx • 3 exceptions"
  4. Optionally call out long-pending orders (in awaiting_shipment >48h).
```

## Idempotency

Both APIs support `Request-Id` / idempotency-key headers but ShipStation's docs are uneven about which endpoints honor them. AutoFlow routines should **check-before-create** for label purchases (which cost real money) — `GET v2 /labels?tracking_number=...` to confirm none exists for this order/shipment combo before POSTing.

## Webhooks

v2 webhook subscriptions are managed via the API:

```
POST /environment/webhooks
body:
  event: "track" (or "batch", "report")
  url: "https://autoflow.example/webhooks/shipstation/{workspace_id}"
```

v1 webhooks are configured **in the ShipStation UI**, not via API. Customer admins set them up once.

Signature verification: v2 includes `X-ShipEngine-Signature` (HMAC-SHA256 of the body). v1 uses a per-store secret embedded in the URL path (the same pattern as Mailchimp). Verify before processing.

Replay safety: dedupe by the `resource_url` field on v2, or by `Resource_id` on v1.

## Rate limits

- **40 requests per minute** per API key (both v1 and v2).
- 429 returns `X-Rate-Limit-Reset` (Unix timestamp). Honor it.
- For label-purchase bursts (Black Friday-style spikes), batch via `/labels/bulk` (v2) — accepts up to 50 labels in one call.

## What this skill does NOT cover

- **In-warehouse pick/pack workflow** — that's a warehouse management system (ShipHero, Skubana). ShipStation receives the result.
- **Carrier account negotiation / rate cards** — handled in ShipStation UI by the customer's ops lead.
- **International customs forms** — supported via v2 `customs` field on shipments, but the regulatory advice is out of scope.
- **3PL integrations** (ShipBob, Easyship) — separate vendors with their own skills if AutoFlow customers reach for them.

## References

- v2 (ShipEngine) API: https://www.shipengine.com/docs/getting-started/
- v1 (ShipStation legacy) API: https://www.shipstation.com/docs/api/
- Webhooks: https://www.shipengine.com/docs/tracking/webhooks/
- Carrier service codes: https://www.shipengine.com/docs/reference/list-carriers/
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; flag which API version is primary per connection)
