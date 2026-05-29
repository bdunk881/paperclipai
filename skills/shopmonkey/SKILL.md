---
name: shopmonkey
description: Use this skill when an AutoFlow agent needs to read or write data in Shopmonkey — the cloud-based shop management platform for independent automotive repair shops, mechanic shops, tire shops, oil-change centers, and specialty automotive (motorcycle, RV, marine, fleet). Pull customers / vehicles / orders / estimates / inspections, react to estimate-approval and order events, sync revenue to QuickBooks, run reminder routines (estimate-not-approved, recommended-service due), manage parts inventory + ordering, automate review requests. Covers Shopmonkey's REST API + OAuth, the Customer / Vehicle / Order / Service / Inspection / Estimate model, automotive-specific compliance considerations (right-to-repair, written authorization), and the workflow shape AutoFlow customers reach for (estimate-to-approval cadence, completed service → invoice + review, vehicle service-history outreach).
---

# Shopmonkey — automotive repair shop management

Shopmonkey is the leading cloud-based shop management system (SMS) for AutoFlow's independent automotive SMBs — mechanic shops, tire stores, oil-change centers, transmission specialists, brake specialists, automotive electrical, motorcycle shops, RV repair, marine repair, fleet maintenance operations. It competes with Mitchell 1 (the entrenched incumbent), Tekmetric, AutoLeap, and other shop-management platforms at the cloud-native end.

Use Shopmonkey when the customer is an **independent auto repair shop**. For dealership service departments → CDK / Reynolds & Reynolds. For fleet management (vehicles ON the road, not vehicles BEING serviced) → Fleetio / Samsara.

## When to reach for this skill

- **Estimate created → approval cadence** — vehicle is in the shop, technician built an estimate; reach the customer for approval (without approval, work can't proceed).
- **Approval received** → schedule the work, order parts not on-hand, notify the tech.
- **Service completed** → invoice generation, payment collection, review request.
- **Recommended service due** — when a previous visit recommended brake pads at 30K miles, customer is now at 28K → outreach to schedule.
- **Vehicle service-history follow-up** — annual touchpoint to customers with vehicles you've serviced.
- **Parts order tracking** — outstanding parts orders + ETA visibility.
- **Tech productivity** — labor hours billed vs labor hours clocked, per tech.
- **Daily reconciliation** — production + collections → QBO.

## Authentication

Shopmonkey uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <shopmonkey-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

For single-shop direct use, API key authentication is also available; OAuth is preferred for AutoFlow's multi-tenant pattern.

Base URL: `https://api.shopmonkey.cloud/`

Multi-location operators: each location has its own Shopmonkey account in most setups. AutoFlow connection records pin per-location; brand groups join across them for cross-location reporting.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Customer | The vehicle owner (person or business) | Can own multiple vehicles |
| Vehicle | A specific car/truck/motorcycle | YMM (year/make/model) + VIN + plate |
| Order (Repair Order / Work Order) | A service visit | The work unit |
| Service | A line item on an order (oil change, brake job) | Labor + parts |
| Part | An ordered part | Tracked from sourcing to install |
| Estimate | The pre-approval order state | Customer must authorize |
| Inspection | A vehicle inspection (multi-point) | Source of recommended services |
| Recommended Service | A flagged future service from prior inspection | Recare/reminder source |
| Invoice | Post-completion bill | Linked to order |
| Payment | A payment against an invoice | Card, cash, financing |
| Tech | A technician (mechanic) | Time + labor attribution |
| Service Writer | Front-office staff (advisor) | Estimate authoring + customer comm |

## Common AutoFlow workflows

### 1. Estimate created → approval cadence

```
Webhook on estimate.created (or order.estimated) → Routine fires →
  1. SMS the customer via Twilio:
       "Your estimate for {vehicle.YMM} is ready: ${total}. Reply A to
        approve, D to decline, or call us at {phone}."
       (Optionally include a portal-link to view the full breakdown)
  2. Wait for response. If no response in 4 business hours:
       SMS reminder: "Just checking in on your estimate. Need any details?"
  3. If no response in 24 hours:
       Surface to service writer for personal phone call
       (Service can't proceed without authorization — moving the
        estimate forward is critical to throughput.)
  4. On A reply: mark approved in Shopmonkey, alert tech
  5. On D reply: mark declined, alert service writer for follow-up.
```

### 2. Service completed → invoice + review

```
Webhook on order.completed → Routine fires →
  1. GET order for final line items + total
  2. If invoice not already created, POST invoice
  3. Send the customer pickup notification:
       SMS: "{vehicle.YMM} is ready! Total: ${invoice.total}. We're
             open until {close_time}."
  4. On vehicle pickup + payment: schedule review-request cron 24h later
  5. POST QBO entries (see quickbooks-online skill):
       Credit Labor Revenue / Parts Revenue / Tax Payable
       Debit Bank or AR
  6. 24h cron: SMS the customer with a Google Business Profile review link
     "How was your visit with {tech.name}? Leave us a review: {link}"
```

### 3. Recommended service due

```
Cron routine weekly →
  1. Query inspections from last 60 days with recommended_services flagged
  2. For each recommended service, compute mileage_due:
       inspection_mileage + miles_per_year_avg * (current_date - inspection_date)
  3. If current_estimated_mileage >= recommended_mileage - 1000:
       Customer is approaching the recommended service window.
       SMS: "Hi {customer.first}, we recommended brake pads on your
             {vehicle.YMM} last visit — you're due soon. Reply BOOK to
             schedule."
  4. On BOOK reply: open scheduling routine, route to service writer queue.
  5. Track recommended-service conversion rate — critical for revenue.
```

### 4. Annual service-history outreach

```
Cron routine daily →
  1. Find customers whose vehicles last visited 11-13 months ago, no
     visit in last 30 days, no upcoming appointment
  2. SMS: "Hi {customer.first}, it's been about a year since we serviced
           your {vehicle.YMM}. Time for an inspection? Reply BOOK or
           call us."
  3. On BOOK reply: open scheduling routine.
  4. Cohort report for annual-retention rate by shop.
```

### 5. Parts order tracking

```
Cron routine every 4 hours during business hours →
  1. Query orders with parts on backorder OR with expected arrival today
  2. Check parts vendor status (if integrated — WorldPac, NAPA, etc.,
     have their own APIs)
  3. SMS the tech assigned: "Parts for order #{N} arrived" or
                              "Parts for order #{N} delayed to {date}"
  4. Update the customer if the delay shifts their promised pickup time:
       SMS: "Parts for your {vehicle.YMM} delayed — new pickup target
             is {new_date}. Sorry for the inconvenience."
```

### 6. Tech productivity scorecard

```
Cron routine daily at 6am →
  1. For each tech:
       hours_clocked (from time clock)
       hours_billed (from order labor line items)
       productivity = hours_billed / hours_clocked (target usually > 80%)
       comebacks (warranty work within 30/60/90 days — quality signal)
       customer_rating_avg
  2. Write to workspace scorecard table
  3. Post Slack DM to each tech:
       "Yesterday: 7.5 hours billed on 8 hours clocked (94% productivity)
        + 1 comeback on order #X to review"
  4. Surface team leaderboard in #service-floor channel.
```

### 7. Daily reconciliation

```
Cron routine at 7pm (after shop-close cadence) →
  1. Aggregate the day's invoices:
       labor_revenue, parts_revenue, supplies_revenue,
       sublet_revenue (work farmed out to specialty subs)
       discounts, tax_collected, tips (if applicable)
  2. POST QBO entries:
       Debit Bank (collected today) or AR (financed)
       Credit Labor Revenue, Parts Revenue, etc.
       Credit Tax Payable
       Debit Discounts expense
  3. Email/Slack the shop owner a daily summary.
```

## Automotive-specific compliance considerations

- **Written authorization** is required in most jurisdictions before performing work — the estimate-approval workflow IS the authorization. If a customer hasn't approved, the shop can't legally charge for unapproved work. AutoFlow routines must surface authorization status clearly; never auto-proceed work without explicit approval.
- **Parts mark-up disclosure** — some states require disclosure of parts mark-up percentages or itemized parts pricing. Configure customer-facing estimates accordingly.
- **Right-to-repair** — laws in some states (Massachusetts, Maine) protect independent shops' access to OEM diagnostic data. Not directly an AutoFlow concern but customer-relevant.
- **Hazardous waste** — used oil, antifreeze, batteries, refrigerant must be disposed of per EPA + state rules. Not an AutoFlow workflow but flagged for completeness.

## Idempotency

Shopmonkey supports idempotency-key on order + invoice creation. For routine-driven writes, use a deterministic key per logical operation.

For customer + vehicle upserts, dedupe by:
- Customer: phone or email
- Vehicle: VIN (the natural unique key) or (customer_id, plate, state) fallback

## Webhooks

Shopmonkey publishes webhooks for major events:
- `order.created`, `order.estimated`, `order.approved`, `order.completed`
- `invoice.created`, `invoice.paid`
- `customer.created`, `vehicle.created`
- `inspection.completed`

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

## Rate limits

Shopmonkey publishes per-account rate limits — typically conservative (low double-digit r/s). 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Dealership service departments** — different software (CDK, Reynolds & Reynolds, DealerSocket); independent shops only.
- **Diagnostic scan tool data** (OBD-II reads) — runs through specialty diagnostic equipment; some integrations to Shopmonkey via inspection module.
- **Aftermarket parts catalog lookup** — handled inside Shopmonkey's UI via WorldPac/PartsTech integration.
- **Vehicle history reports** (Carfax, AutoCheck) — separate subscriptions; result attached to vehicle record.
- **Fleet customer billing** — supported but complex; vendor-specific accounting needs.

## References

- API: https://docs.shopmonkey.cloud/
- Webhooks: https://docs.shopmonkey.cloud/webhooks
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-shop credentials; authorization-gate guard on work-proceed routines)
