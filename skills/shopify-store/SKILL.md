---
name: shopify-store
description: Use this skill when an AutoFlow agent needs to read or write data in a Shopify store — fetch orders / products / customers, react to order webhooks (create QuickBooks invoice, sync to HubSpot, fulfill via ShipStation), update inventory, surface store events into a routine. Covers the Admin API (REST + GraphQL), Storefront API distinction, OAuth/access-token auth, and the workflow shape AutoFlow customers reach for (new order → invoice + fulfillment, abandoned checkout → recovery email, product update → catalog sync).
---

# Shopify — e-commerce platform

Shopify is the most common e-commerce stack for AutoFlow's SMB segment that sells physical or digital goods. It sits upstream of accounting (QuickBooks invoices from orders), fulfillment (ShipStation), and marketing (HubSpot contact upsert, Klaviyo events).

## When to reach for this skill

- **New order** → create a QBO invoice, upsert a HubSpot contact, trigger fulfillment.
- **Order paid** → record the Stripe charge in QBO, log revenue to a dashboard.
- **Order fulfilled** → notify the customer in Slack, log shipping cost.
- **Abandoned checkout** → fire a recovery email routine.
- **Inventory low** → alert the operations channel.
- **Product update** → sync the product catalog to a CRM or warehouse.

## Authentication

Two APIs, two auth models:

- **Admin API** (private to the store) — access token from a custom/private app the merchant installs. AutoFlow always uses this for write operations.

  ```
  X-Shopify-Access-Token: shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ```

- **Storefront API** (public, customer-facing) — for headless storefronts. Read-only access to the public product catalog. AutoFlow rarely uses this unless the customer is on a headless setup.

For multi-tenant SaaS apps, OAuth 2.0 is also supported (`/admin/oauth/access_token`). AutoFlow's `ticketSync` schema (`src/ticketSync/`) handles the `oauth2_pkce` path. For most SMB customers, the custom-app token is simpler.

Shop URL pattern: `https://{shop}.myshopify.com/admin/api/{api_version}/` — the shop subdomain is the canonical store identifier and must be captured at connection time.

API version: pin to a quarterly release (e.g. `2026-04`) — Shopify supports the last 12 months; older versions return 401 with a deprecation notice. Re-version every 6-9 months as part of dependency maintenance.

## REST vs GraphQL

Both work; **Shopify is migrating to GraphQL-first**. New endpoints land in GraphQL only.

- **REST** — `/admin/api/2026-04/orders.json` — convenient for simple list/get, but rate-limited per-call.
- **GraphQL** — `/admin/api/2026-04/graphql.json` — one endpoint, query-shaped, **rate-limited by query cost** (you can fetch dozens of associated resources in one call without burning extra rate budget).

Default to GraphQL for any new integration; reach for REST only for endpoints that don't have a GraphQL equivalent (rare in 2026).

## Core resources

| Resource | What it is | AutoFlow pattern |
|---|---|---|
| Order | The customer's purchase | Source of truth for QBO invoice creation |
| LineItem | One product entry in an order | Maps to QBO `Line[]` |
| Customer | The buyer | Upsert to HubSpot by email |
| Product / Variant | The catalog | Read for catalog sync; rarely mutated by agents |
| InventoryLevel | Stock per variant per location | Read for low-stock alerts |
| Fulfillment | Shipped portion of an order | Created when the warehouse confirms |
| Transaction | The payment record on an order | Maps to QBO Payment |
| AbandonedCheckout | Cart that didn't convert | Source for recovery routines |
| DraftOrder | Pre-checkout invoice the merchant builds | Useful for B2B / quote workflows |

## Common AutoFlow workflows

### 1. New order → QBO invoice + HubSpot contact

```
Shopify orders/create webhook → Routine fires →
  1. Upsert HubSpot contact by order.email (see hubspot-crm skill)
  2. For each order.line_items[], look up the QBO Item.Ref
     (map by SKU; create if missing on first sale)
  3. POST QBO /invoice:
       CustomerRef = QBO customer (looked up by email or created)
       Line[]      = mapped line items
       PrivateNote = shopify_order_id for audit
  4. PATCH Shopify order metafields with the QBO invoice ID for traceback.
```

### 2. Order paid → QBO payment record

```
Shopify orders/paid webhook → Routine fires →
  1. GET /admin/api/.../orders/{id}/transactions.json
  2. For each kind=sale transaction, POST QBO /payment:
       CustomerRef     = matched customer
       Line[].LinkedTxn = pointer to the QBO invoice (from step 1 above)
       PrivateNote      = shopify_transaction_id
```

### 3. Abandoned checkout recovery

```
Cron routine every 1h →
  1. GET /admin/api/.../checkouts.json?status=open&updated_at_min={1h ago}
  2. For each checkout where customer.email exists,
     POST Klaviyo (or Mailchimp) event "Abandoned Checkout"
     with the checkout.abandoned_checkout_url
  3. The email platform's automation triggers a 1-email recovery flow.
```

### 4. Low-stock alert

```
Cron routine every 6h →
  1. GraphQL: query all InventoryLevel where available < threshold
     {
       inventoryItems(first: 50, query: "tracked:true") {
         edges { node { id sku inventoryLevels(first: 10) { edges { node { available location { name } } } } } }
       }
     }
  2. Aggregate variants under threshold; post a Slack alert to ops.
```

## Webhooks

Configured per-store via Admin API:
```
POST /admin/api/.../webhooks.json
Body:
  webhook:
    topic: "orders/create"
    address: "https://autoflow.example/webhooks/shopify/{shop_id}/orders-create"
    format: "json"
```

Signature verification: `X-Shopify-Hmac-Sha256` is an HMAC of the raw body with the store's webhook secret. **Validate before parsing JSON** (signature is over the bytes, not the parsed object).

Webhook **topic** examples agents reach for most:
- `orders/create`, `orders/paid`, `orders/cancelled`, `orders/fulfilled`
- `customers/create`, `customers/update`
- `products/update`, `inventory_levels/update`
- `checkouts/create`, `checkouts/update` (the abandoned-cart source)

Replay safety: Shopify sometimes redelivers the same webhook (especially on transient handler failure). Use the `X-Shopify-Webhook-Id` header as the idempotency key.

## Rate limits

REST: **2 requests/sec per shop** with a 40-request burst bucket. GraphQL: a more generous query-cost budget (~1000 points/sec with a 1000-point bucket; complex queries cost 100s).

Honor 429 with `Retry-After`. For bulk reads, prefer **Bulk Operations** (GraphQL) — submit a query, get back a JSONL file with the entire result set, no rate burn.

## Idempotency

`X-Idempotency-Key` is supported on REST endpoints that create resources. Use a deterministic key per logical op (e.g. `routine-run-id|operation`) so retries don't double-create.

## What this skill does NOT cover

- **POS / Hardware-specific integrations** — Shopify POS for retail is a separate surface; AutoFlow customers using POS usually still expose orders via the Admin API.
- **Shopify Functions** (custom checkout logic) — those run inside Shopify, not from AutoFlow.
- **Markets** (multi-currency / region) — handle this at the orders layer (the order already has `presentment_currency` set); no special skill needed.
- **Shopify Flow** (Shopify's internal automation) — overlaps with AutoFlow's job, so customers don't usually configure both.

## References

- Admin REST: https://shopify.dev/docs/api/admin-rest
- Admin GraphQL: https://shopify.dev/docs/api/admin-graphql
- Webhooks: https://shopify.dev/docs/apps/webhooks
- API versioning: https://shopify.dev/docs/api/usage/versioning
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key, both supported)
