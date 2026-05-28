---
name: boulevard
description: Use this skill when an AutoFlow agent needs to read or write data in Boulevard — the practice-management platform for premium salons, spas, barbershops, medspas, and personal-care businesses. Pull appointments / clients / services / staff / sales, react to booking and checkout events, push purchases to QuickBooks, run reactivation routines, manage memberships and gift cards. Covers Boulevard's GraphQL API + business-token auth, the Business / Location / Client / Appointment / Service / Order model, and the workflow shape AutoFlow customers reach for (appointment booked → CRM upsert + reminder cadence, sale completed → QBO journal + loyalty signal, membership lapsed → win-back).
---

# Boulevard — premium salon, spa, and personal-care management

Boulevard is the leading practice-management platform for AutoFlow's premium-personal-care SMBs — high-end hair salons, day spas, medspas, barbershops, nail studios, wellness clinics. It's chosen over Mindbody when the customer prioritizes a polished client experience (modern booking UI, in-product messaging, brand customization, and tighter staff/inventory controls) and is positioned upmarket from typical Square Appointments or Mindbody users.

Use Boulevard when the customer is in **premium personal care + appointment-driven services** and explicitly chose it for the brand experience. For mid-market fitness/wellness studios → Mindbody. For mobile services → Jobber.

## When to reach for this skill

- **Appointment booked** → CRM upsert, send confirmation + 24h reminder via Twilio (Boulevard does this natively, but customers often want their own brand voice).
- **Appointment completed / checked-out** → push to QuickBooks for daily revenue reconciliation, fire post-visit survey via Typeform or Mailchimp.
- **No-show / late cancel** → policy-driven fee via Boulevard's deposit/card-on-file, then notification to client.
- **Membership purchased** → onboarding routine + first-visit incentive.
- **Membership lapsed** → win-back sequence via Mailchimp/Klaviyo with a reactivation offer.
- **High-LTV client identified** → flag in HubSpot for VIP outreach.
- **Inventory low** (for retail-heavy spas/salons) → reorder routine.

## Authentication

Boulevard uses a **business-token-based auth** model with HMAC-signed requests:

- Each business gets a **Business ID** (`businessId`) and an **API key + secret** pair from the Boulevard developer dashboard.
- Requests are signed with HMAC-SHA256 over the request body + a timestamp; the signature goes in an `Authorization` header.

```
Authorization: Bearer <base64-encoded-business-credential>
X-Boulevard-Timestamp: <unix-timestamp-ms>
```

The exact signing scheme is published in Boulevard's developer docs; SDKs are available for Node and Python. AutoFlow's pattern: use the official SDK rather than rolling the signing manually.

For multi-tenant SaaS apps, Boulevard also supports OAuth-style access via their Partner program (rollout phase as of 2026 — check current state at integration time).

Base URL: `https://dashboard.joinblvd.com/api/2020-01/`

API version is path-prefixed (`/api/2020-01/`); pin to a known release.

## Locations gotcha

Boulevard businesses can have **multiple locations** (e.g. a salon chain with 5 storefronts). Almost every resource is **location-scoped** — Appointments, Orders, Inventory all reference a `locationId`. AutoFlow connection records should pin a per-location workflow split or pick a default location at install.

## Core API surface

Boulevard's API is **GraphQL-only**:

| Resource | What it represents | Key fields |
|---|---|---|
| Business | The brand/account | businessId, businessName |
| Location | A physical storefront | locationId, address, timezone |
| Client | The guest/customer | id, firstName, lastName, email, phone, lifetimeValue |
| Service | A bookable offering | id, name, duration, price |
| Staff (Provider) | Stylist, esthetician, etc. | id, name, services[], schedule |
| Appointment | A scheduled service | id, startAt, endAt, services[], staff, client |
| Order | A point-of-sale or checkout transaction | id, items[], total, payments[] |
| Membership | Recurring service plan | id, name, price, services_included[] |
| Gift Card | Stored-value card | id, balance, original_value |

## Common AutoFlow workflows

### 1. Appointment booked → confirm + reminder

```
Boulevard webhook on appointment.created → Routine fires →
  1. GraphQL query for appointment + client + service + staff
       query {
         appointment(id: $id) {
           startAt, endAt,
           services { name, durationMinutes, price },
           staff { displayName },
           client { firstName, email, mobilePhone }
         }
       }
  2. Compute reminder text in customer brand voice:
       "Hi {firstName}, you're booked for {service} with {staff} on
        {date} at {time}. Reply CANCEL to free your spot."
  3. POST Twilio SMS at booking time + schedule cron 24h before
  4. HubSpot PUT contact: tag with service category for marketing
     segmentation ("hair-color", "facial", "balayage", etc.).
```

### 2. Checkout completed → QBO + post-visit survey

```
Boulevard webhook on order.completed → Routine fires →
  1. Aggregate the day's orders into a daily journal entry (cron at 11pm
     site-local), OR per-order entry for high-resolution accounting
  2. POST QBO /journalentry:
       Debit Bank "Boulevard Clearing" (net deposit)
       Debit Processing Fees expense
       Credit Service Revenue (services)
       Credit Retail Revenue (products)
       Credit Tips Payable (tips)
       Credit Gift Card Liability (gift card purchases)
       PrivateNote: "Boulevard {date} reconciliation"
  3. Schedule cron 24h after checkout:
       Send Typeform survey link via Twilio SMS to the client
         "How was your visit with {staff}? {link}"
  4. NPS detractor scores trigger Customer Success outreach.
```

### 3. Membership purchased → onboarding routine

```
Boulevard webhook on membership.created → Routine fires →
  1. GET membership details + client + services_included
  2. Send a welcome email via SendGrid (transactional template) covering:
       - Membership benefits + first-visit incentive
       - How to book covered services
       - Loyalty points earnings
  3. Schedule a 30-day check-in:
       SMS "How are you enjoying your membership? Any questions?"
  4. Tag in HubSpot lifecyclestage = "customer-membership-active".
```

### 4. Membership lapsed → win-back

```
Cron routine weekly →
  1. GraphQL query for clients with membership.status = "canceled" or
     "expired" within last 30 days, where lifetimeValue > $X threshold
  2. For each, enroll in Mailchimp/Klaviyo "win-back" flow:
       Day 0: empathetic check-in, no offer
       Day 7: "we miss you" with a reactivation perk
       Day 21: final offer with deeper discount
  3. Tag in HubSpot: "membership-winback-active" to avoid double-touching
     via other campaigns.
```

### 5. High-LTV client → VIP outreach signal

```
Cron routine monthly →
  1. GraphQL query clients ordered by lifetimeValue desc, page 0-99
  2. For each top-percentile client (configurable threshold per workspace):
       Check if they've visited in last 60 days
       If yes, tag in HubSpot as "vip-active" → CSM Slack alert for
       quarterly personal outreach
       If no, tag as "vip-at-risk" → priority win-back
  3. Surface the list on the workspace dashboard.
```

## Idempotency

Boulevard's mutations support idempotency keys on order creation + appointment booking. Use them for routine-driven writes with a deterministic key (`routine-run-{run_id}-boulevard-{operation}`).

For client upserts, query by `mobilePhone` or `email` first — Boulevard treats both as natural unique identifiers within a business.

## Webhooks

Configure via the API or partner-program portal:

```
mutation {
  webhookSubscriptionCreate(input: {
    callbackUrl: "https://autoflow.example/webhooks/boulevard/{workspace_id}",
    events: [APPOINTMENT_CREATED, ORDER_COMPLETED, MEMBERSHIP_CREATED]
  }) { webhookSubscription { id, secret } }
}
```

Signature verification: `X-Boulevard-Signature` is HMAC-SHA256 of body using the per-subscription secret. **Verify before processing.**

Replay safety: payloads include `eventId`; dedupe.

## Rate limits

- **Per-business GraphQL cost budget** — Boulevard publishes specifics per integration tier; default ~1000 cost-points/second.
- 429 returns standard `Retry-After`.
- Bulk reads (LTV ranking, monthly cohorts) should use cursor pagination + `?modifiedSince=`.

## Multi-tenant pattern

For brand groups with multiple businesses (e.g. a holding company with 4 spa brands), each business is its own Boulevard account with its own credentials. AutoFlow's pattern: treat each `(businessId)` as a separate connection; brand-level reporting joins across them.

## What this skill does NOT cover

- **Boulevard Booker** (their consumer booking widget) — managed in Boulevard's UI; agents don't customize it.
- **Boulevard Pay** (their integrated payment processor) — transactions flow through Boulevard's normal Order objects; no separate API surface.
- **Inventory PO management** — supported but agents rarely need full P&L over PO chains; build a dedicated skill if needed.
- **Marketing Suite** — overlaps with Mailchimp/Klaviyo; pick one.
- **Boulevard Insights** (their analytics product) — read via the Order/Appointment queries; no separate analytics API.

## References

- API: https://developers.joinblvd.com/
- GraphQL playground: https://dashboard.joinblvd.com/api/2020-01/graphql
- Webhooks: https://developers.joinblvd.com/docs/webhooks
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-business + per-location pinning; HMAC request signing via SDK)
