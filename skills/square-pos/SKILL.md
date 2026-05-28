---
name: square-pos
description: Use this skill when an AutoFlow agent needs to read or write data in Square — list payments / orders / catalog / customers across retail, services, and food-and-beverage Square Sellers, push sales into QuickBooks, react to Square webhook events (payment.created, order.fulfillment.updated), create invoices, or manage customer profiles. Covers Square's OAuth 2 + Personal Access Token auth, the Locations-scoped resource model, the Payments / Orders / Catalog / Customers / Invoices / Bookings model, and the workflow shape AutoFlow customers reach for (sale → QBO journal entry, refund → Stripe-style reverse flow, low-stock alert, appointment booked → CRM upsert).
---

# Square — POS, payments, online store, bookings

Square is the dominant point-of-sale + payments platform for AutoFlow's SMB segment that takes in-person payments — small retail, services, salons, restaurants (though restaurants often choose Toast instead), pop-ups, side hustles. It also runs a hosted online store and an appointments product, making it more than just a POS.

Use Square *instead of* Stripe when the customer takes in-person card payments (Square owns the hardware + processing). Use *alongside* Stripe when the customer takes both — Square for retail, Stripe for online subscriptions.

## When to reach for this skill

- **Sale completed (POS)** — push to QuickBooks as a journal entry, update inventory in Square Catalog.
- **Refund issued** — reverse the QBO journal entry, log to a reporting dashboard.
- **Customer profile created** — sync to HubSpot as a Contact for marketing follow-up.
- **Invoice paid** — when a Square Invoice is paid, fire the same downstream as the Stripe invoice path (CRM update, fulfillment trigger).
- **Low-stock alert** — daily cron over Catalog inventory, Slack alert on low SKUs.
- **Appointment booked** (Square Appointments) → Calendly-style routine — CRM upsert + reminder SMS.
- **Daily reconciliation** — pull all Payments + Refunds for the day, post a single journal entry to QBO covering net deposit.

## Authentication

Two paths:

- **OAuth 2** — multi-tenant SaaS apps (AutoFlow's preferred path). Authorization-code flow with refresh tokens. Tokens rotate every ~30 days; AutoFlow re-mints before expiry.
- **Personal Access Token** — single-seller, simplest. Created in the seller's Square Developer dashboard. Use for AutoFlow's per-workspace integrations where the customer connects their own Square account.

```
Authorization: Bearer <square-access-token>
Square-Version: 2026-04-16
Content-Type: application/json
```

`Square-Version` is **required** — Square versions per-call. Pin to a known release (currently `2026-04-16` — check Square's release notes for the latest stable). Missing the header gets you the default at request time.

Sandbox: `connect.squareupsandbox.com`. Production: `connect.squareup.com`. Always confirm env before any write.

Base URL: `https://connect.squareup.com/v2/`

## Locations gotcha

Every Square Seller has one or more **Locations** (physical stores, online store, etc.). **Almost every resource is location-scoped** — Payments, Orders, Catalog Inventory, Bookings — and writes that omit `location_id` go to the default location, which may not be what you want.

After OAuth, the first call is `GET /v2/locations` to enumerate all locations. AutoFlow's connection record should let the customer pick a default or pin a per-location workflow split.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Locations | `/locations` | Enumerate the seller's physical/online locations |
| Payments | `/payments/{id}` | A card / cash / Apple Pay transaction |
| Refunds | `/refunds/{id}` | A reversed payment |
| Orders | `/orders/{id}` | The Square Order object (line items, taxes, fulfillments) |
| Order Search | `/orders/search` | Cross-location order query |
| Catalog | `/catalog/object/{id}` | A product, variation, category, or modifier |
| Catalog Search | `/catalog/search` | Filtered queries over the catalog |
| Inventory | `/inventory/changes/batch-create` | Stock adjustments per location |
| Customers | `/customers/{id}` | Buyer record |
| Invoices | `/invoices/{id}` | Square's hosted invoice product |
| Bookings | `/bookings/{id}` | Square Appointments record |
| Team Members | `/team-members/{id}` | Staff (for tip / commission attribution) |
| Webhook Subs | `/webhooks/subscriptions` | Push-event subscription management |

## Common AutoFlow workflows

### 1. Daily reconciliation — Square sales → QBO journal entry

```
Cron routine at 11pm seller-local time →
  1. GET /payments?begin_time={today_00:00}&end_time={today_23:59}
     (paginate; sellers can have hundreds of payments)
  2. Aggregate by:
       gross_sales (sum of approved payment.amount_money)
       tips        (sum of payment.tip_money)
       refunds     (sum of refund.amount_money for refunds.created today)
       fees        (sum of payment.processing_fee.amount_money)
       net_deposit = gross_sales + tips − refunds − fees
  3. POST QBO /journalentry (see quickbooks-online skill):
       Debit Bank "Square Clearing" (net_deposit)
       Debit Processing Fees expense (fees)
       Debit Refunds (refunds)
       Credit Sales Revenue (gross_sales)
       Credit Tips Payable (tips)
       PrivateNote: "Square daily reconciliation for {date}"
```

### 2. Inventory low-stock alert

```
Cron routine every 2h →
  1. GET /catalog/list?types=ITEM_VARIATION (paginate)
  2. For each variation with track_inventory: true,
     GET /inventory/{variation_id}?location_ids={primary_location_id}
  3. If quantity < threshold (per-SKU configured in workspace setting):
       Aggregate the low-stock list
  4. POST to #ops Slack channel:
       "Low stock at Main St:
          - Widget A (12 left, threshold 20)
          - Widget B (3 left, threshold 10)"
```

### 3. Customer profile → HubSpot sync

```
Square webhook customer.created → Routine fires →
  1. Verify webhook signature
  2. GET /customers/{id} for email + phone + address
  3. HubSpot PUT /crm/v3/objects/contacts/{email}?idProperty=email
       properties: {
         firstname, lastname, phone, address,
         square_customer_id: customer.id,
         source: "square-pos"
       }
       set lifecyclestage=customer (since they already bought)
```

### 4. Square Invoice paid → invoice paid downstream

```
Square webhook invoice.payment_made → Routine fires →
  1. Read invoice_id from payload
  2. GET /invoices/{id} for amount + customer + line items
  3. Fire the same downstream as the Stripe-invoice flow:
       - QBO Payment record (see quickbooks-online skill)
       - HubSpot deal stage update if linked
       - SendGrid receipt email
```

### 5. Appointment booked → SMS reminder + CRM

```
Square webhook booking.created → Routine fires →
  1. GET /bookings/{id} for customer_id + start_at + service variations
  2. Upsert customer in HubSpot (similar to workflow 3)
  3. Schedule cron 24h before start_at:
       POST Twilio /Messages "Reminder: appointment tomorrow at {time}"
  4. Tag in Klaviyo/Mailchimp for post-appointment follow-up flow.
```

## Idempotency

`Idempotency-Key` (note the dash) is **required** on most Square write endpoints. Square will reject the request without it. Use a deterministic key per logical operation — e.g. `routine-run-{run_id}-square-payment`.

This is one of Square's strictest features compared to peers — agents that forget it get cryptic 400s.

## Webhooks

Webhook subscriptions are managed via API or the Developer Dashboard:

```
POST /webhooks/subscriptions
body:
  subscription:
    name: "AutoFlow workspace {workspace_id}"
    event_types: ["payment.created", "refund.created", "customer.created",
                  "invoice.payment_made", "booking.created", "order.fulfillment.updated"]
    notification_url: "https://autoflow.example/webhooks/square/{workspace_id}"
    api_version: "2026-04-16"
```

Signature verification: `x-square-hmacsha256-signature` is base64(HMAC-SHA256(notification_url + body)) — note the prepended notification URL. **Verify before processing** — payment events are high-value targets.

Replay safety: events have a stable `event_id`; dedupe on AutoFlow's side.

## Rate limits

- **10 requests/sec** per access token sustained.
- **Burst budget** allows short spikes.
- 429 returns standard `Retry-After`.
- Batch endpoints exist for inventory adjustments + bulk catalog operations — use them when touching many items.

## What this skill does NOT cover

- **Square Online (web store)** — its own product surface; for AutoFlow customers selling online via Square Online, the relevant data flows through the standard Orders API.
- **Square for Retail** (the retail-specific UI on top of standard Square) — same API, no skill difference.
- **Square Banking** — banking-as-a-service; rarely on AutoFlow's path.
- **Cash App for Business** — separate product; Square ↔ Cash App auth flows aren't bridged.
- **Square Loyalty + Gift Cards** — its own subsurface; build a separate skill if a customer needs deep loyalty automation.

## References

- API: https://developer.squareup.com/reference/square
- Versioning: https://developer.squareup.com/docs/build-basics/api-lifecycle
- Webhooks: https://developer.squareup.com/docs/webhooks/overview
- OAuth: https://developer.squareup.com/docs/oauth-api/overview
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; 30-day token rotation; location selection at install)
