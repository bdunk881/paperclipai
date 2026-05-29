---
name: housecall-pro
description: Use this skill when an AutoFlow agent needs to read or write data in Housecall Pro — the field-services management platform for small-to-mid home-services operators (HVAC, plumbing, electrical, cleaning, garage door, locksmith, handyman, pool, landscaping, pest, junk removal) sitting between Jobber's solo/micro shape and ServiceTitan's enterprise scale. Pull customers / jobs / estimates / invoices / employees, react to job events, push revenue to QuickBooks, run dispatch + reminder routines, manage memberships and recurring service plans. Covers Housecall Pro's REST API + API-key auth, the Customer / Job / Estimate / Invoice / Employee / Membership model, and the workflow shape AutoFlow customers reach for (dispatch optimization, completion → invoice + review, recurring service plan management).
---

# Housecall Pro — mid-tier home services management

Housecall Pro is the middle-tier home-services management platform — sitting between Jobber's solo-operator/micro shape and ServiceTitan's enterprise scale. Used by ~35,000 home-service businesses across HVAC, plumbing, electrical, cleaning, garage door, locksmith, handyman, pool service, landscaping, pest control, junk removal, appliance repair, and adjacent trades.

Use Housecall Pro when the customer is a **growing home-services business** with 2-15 technicians, has outgrown solo tools but isn't ready for ServiceTitan's complexity + price. For solo operators → Jobber. For larger / multi-location ops → ServiceTitan. For dental/medical/legal → vertical-specific.

## When to reach for this skill

- **Estimate sent → approval cadence** — customer needs to approve before work proceeds.
- **Job scheduled → tech notification** — dispatch routine.
- **Job completed → invoice + payment + review** — capture the moment of customer satisfaction.
- **Recurring service plan / membership management** — monthly/annual maintenance plans drive recurring revenue.
- **Online booking integration** — capture leads from the website + auto-route to availability.
- **Marketing automation** — review-request, win-back, post-service nurture.
- **Daily revenue close** → QBO entries.

## Authentication

Housecall Pro uses **API key + Auth Token** authentication via OAuth-style partner integration:

```
Authorization: Bearer <housecall-pro-access-token>
```

Partner OAuth flow per company; access tokens last ~1 hour; refresh tokens rotate on use.

Base URL: `https://api.housecallpro.com/`

Multi-location operators typically have one Housecall Pro account per business entity. AutoFlow connection records pin per-account.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Company | The Housecall Pro tenant | Top-level scope |
| Customer | The homeowner/business client | One customer can have many properties |
| Address | A service location | Where work happens |
| Job | A scheduled service visit | The work unit |
| Estimate | A priced proposal | Customer must approve |
| Estimate Option | An optional line in an estimate (good/better/best) | Customer picks |
| Invoice | Post-completion billing | Linked to job |
| Payment | Money received | Card, check, cash, financing |
| Line Item | A service or material on a job/estimate/invoice | Pricebook-driven |
| Employee | A tech, dispatcher, office staff | Schedule + permissions |
| Schedule | A tech's assigned jobs | Daily/weekly view |
| Membership / Plan | Recurring service agreement | Annual maintenance, tune-up plans |
| Lead Source | Where a customer came from | For marketing attribution |
| Tag | Workflow categorization | Internal filtering |

## Common AutoFlow workflows

### 1. Estimate sent → approval cadence

```
Webhook on estimate.sent → Routine fires →
  1. SMS the customer via Twilio:
       "Your estimate for {service} is ready: ${total}. View + approve:
        {portal_link}. Reply A to approve or call us at {phone}."
  2. If multi-option estimate (good/better/best): include option summary
  3. Cron 24h after send: if no response, SMS reminder
  4. Cron 72h after send: surface to office for personal call
                          (estimate-to-close window is the highest-
                           leverage moment for revenue capture)
  5. On A reply: mark approved + alert dispatch to schedule
  6. On call-needed: route to office queue with the estimate context.
```

### 2. Job completed → invoice + payment + review

```
Webhook on job.completed → Routine fires →
  1. Verify invoice generated; if not, POST invoice
  2. Send the customer pickup/payment notification:
       SMS: "Your service is complete. Total ${amount}. Pay online:
             {payment_link} or call for assistance."
  3. On payment received: schedule review request 24h later
       SMS: "How was {tech.first}? Review us on Google: {link}"
       (Boost rating on the most important platforms for the trade —
        HVAC/plumbing → Google; cleaning → Yelp + Nextdoor; etc.)
  4. POST QBO journal entries:
       Credit Service Revenue (per service-category line)
       Debit Bank or AR
  5. If review received + ≥4 stars: post a Slack celebration to the
     tech's channel.
```

### 3. Recurring service plan management

```
Cron routine daily →
  1. Query active memberships/plans with next-service-due within 30d
  2. Build the next service appointment per plan:
       schedule onto the assigned tech's calendar
       SMS the customer 7 days out: "Your annual tune-up is scheduled
                                      for {date}."
  3. Track plan renewals at expiration:
       60d out: SMS renewal reminder
       30d out: SMS + email + portal nudge
       0d (lapse): tag for win-back; offer reactivation discount
  4. Recurring-plan retention is a key metric (~80% benchmark for
     well-managed plans).
```

### 4. Dispatch optimization

```
Continuous routine during dispatch hours →
  1. Read today's open jobs + tech schedules
  2. For unassigned jobs, score available techs:
       - skill match for service type
       - current location distance to job address
       - utilization for the day (don't overload one tech)
       - estimated job duration vs tech's remaining capacity
  3. Recommend the highest-scoring tech OR auto-assign per workspace
     policy (workspace setting: "AutoFlow recommends" vs "AutoFlow
     auto-assigns within tolerance")
  4. SMS the tech with the assignment + customer SMS with ETA window.
```

### 5. Online booking → lead capture

```
Webhook on online_booking.created → Routine fires →
  1. Validate the customer's address + service requested fits
     Housecall Pro coverage
  2. Look up matching tech availability for the requested window
  3. Auto-schedule OR surface to dispatcher for manual assignment
  4. Confirm to customer via SMS + email
  5. Tag the lead source = "Website Booking" for marketing attribution.
```

### 6. Marketing automation — review + win-back

```
Cron routine daily →
  1. Review-request: customers serviced 2-3 days ago without a review
     yet → personalized SMS asking for review
  2. Win-back: customers serviced 11-13 months ago, no service since,
     no scheduled appointment → seasonal-relevant SMS
     ("It's been a year since we serviced your HVAC. Time for a
       tune-up?")
  3. Track conversion rate of win-back outreach (typical 5-10% for
     well-targeted home-services).
```

### 7. Daily revenue close

```
Cron routine at 7pm →
  1. Aggregate the day's invoices:
       service revenue (per category — HVAC repair, install, maintenance,
                        plumbing service, etc.)
       parts/materials revenue
       discounts, late fees, tips
  2. POST QBO entries:
       Debit Bank/AR
       Credit Service Revenue (per category)
       Credit Parts Revenue
       Credit Tips Payable
       Debit Discounts expense
  3. Slack/email the owner a daily summary with KPIs:
       jobs completed, gross revenue, avg ticket, gross margin
       (if labor + materials are tracked).
```

## Idempotency

Housecall Pro's API supports idempotency on payment + invoice creation. For routine-driven writes, use deterministic keys.

For customer + address upserts, dedupe by phone + address before creating.

## Webhooks

Housecall Pro publishes webhooks for major events:
- `customer.created`, `customer.updated`
- `estimate.sent`, `estimate.approved`, `estimate.declined`
- `job.created`, `job.scheduled`, `job.in_progress`, `job.completed`
- `invoice.created`, `invoice.paid`
- `membership.created`, `membership.canceled`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Housecall Pro publishes per-account rate limits. Typically conservative; 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Comprehensive accounting** beyond GL sync — full job-cost accounting + payroll lives in QBO or specialty tools.
- **In-vehicle telematics** (GPS fleet tracking) — separate vendors (Samsara, Verizon Connect).
- **OEM diagnostic tools** (HVAC system diagnosis, manufacturer-specific) — separate tools.
- **Materials sourcing** (Ferguson, etc.) — APIs available from those vendors directly.
- **Comprehensive marketing automation** — beyond basic review/win-back, route through Mailchimp/Klaviyo.

## References

- API: https://docs.housecallpro.com/
- Webhooks: https://docs.housecallpro.com/#webhooks
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-account credentials; service-category mapping at install for QBO chart)
