---
name: servicetitan
description: Use this skill when an AutoFlow agent needs to read or write data in ServiceTitan — the enterprise-grade field-services platform for larger HVAC, plumbing, electrical, garage-door, and home-services operators (typically 5+ techs up to multi-location franchises). Pull jobs / customers / invoices / dispatch / inventory, react to dispatch and completion events, push revenue to QuickBooks, run technician productivity routines, manage memberships and recurring service agreements. Covers ServiceTitan's tenant-scoped OAuth + app-key auth, the Tenant / Customer / Location / Job / Invoice / Dispatch / Membership model, and the workflow shape AutoFlow customers reach for (dispatch optimization, completion → invoice + review request, membership renewal cadence, technician scorecard reporting).
---

# ServiceTitan — enterprise home services management

ServiceTitan is the dominant platform for **larger** AutoFlow home-services SMBs — HVAC, plumbing, electrical, garage doors, septic, drain cleaning, pest control, water treatment, generator service. Operators with 5-100+ technicians, multiple service categories, and often multiple locations or franchise units pick ServiceTitan over Jobber because of its dispatch sophistication, member-program tooling, deeper reporting, and enterprise-scale CRM.

Use ServiceTitan when the customer has **5+ technicians, runs a dispatch operation, and treats home services as a real operations business**. For solo operators or micro-businesses (<5 techs) → Jobber. For office-bound services → HubSpot.

## When to reach for this skill

- **Dispatch optimization** → route the right tech to the right job based on skills, location, parts on truck.
- **Job completed** → invoice generation, customer review request (Google Business Profile, Yelp, BBB), QBO revenue posting.
- **Membership renewal** — Memberships (monthly/annual recurring service agreements like a furnace tune-up plan) are core to ServiceTitan operators. Renewal automation drives recurring revenue.
- **Technician productivity scorecard** — daily/weekly aggregation of completed jobs, revenue per tech, callbacks, customer ratings.
- **Inventory + truck stock** — replenishment routine when parts run low across the fleet.
- **Marketing attribution** — pull lead-source data on completed jobs to inform marketing spend.
- **Capacity planning** — daily routine forecasting next-day technician capacity vs booked + estimated walk-ins.

## Authentication

ServiceTitan uses a **two-layer auth model**:

1. **App-Key authentication** — every request requires a header for AutoFlow's registered app:

   ```
   ST-App-Key: <autoflow-app-key>
   ```

2. **Tenant access token** — issued per customer tenant via OAuth client-credentials:

   ```
   POST /tenant/{tenant_id}/oauth/token
   Body: grant_type=client_credentials&client_id=...&client_secret=...

   Subsequent calls:
   Authorization: Bearer <tenant-access-token>
   ST-App-Key: <autoflow-app-key>
   ```

`tenant_id` is the numeric ServiceTitan tenant identifier (each customer's account). AutoFlow's `ticketSync` schema (`src/ticketSync/`) stores `(tenant_id, client_id, client_secret)` per connection.

Access tokens expire in ~30 minutes; re-mint via the credentials. There's no separate refresh token — credentials → token every cycle.

Base URL: `https://api.servicetitan.io/`

Production vs Integration (sandbox): `api-integration.servicetitan.io` for testing. Always confirm env.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Tenant | A ServiceTitan account | Top-level scope; one per customer |
| Customer | The homeowner/business buying service | One customer can have many Locations |
| Location | A specific address served | Where work happens |
| Job | A scheduled service visit | The work unit |
| Appointment | A specific time-on-site for a job | A job can have multiple appointments |
| Invoice | Bill for completed work | Linked to a job |
| Payment | Money received against an invoice | Includes financing options |
| Estimate | A proposed price + scope | Sent before job acceptance |
| Membership | Recurring service agreement | Tune-up plans, priority service, etc. |
| Equipment | Customer's installed equipment (HVAC unit, water heater) | Tracked for warranty + service history |
| Technician | Field employee | Has skills, schedule, truck inventory |
| Business Unit | A revenue/profit center (e.g. "HVAC Install" vs "Plumbing Service") | Reports roll up by BU |
| Campaign | Marketing campaign (driving lead source attribution) | Lead → Job → Revenue tracking |
| Call | An inbound customer call | Logged with disposition + booked-job link |

## Common AutoFlow workflows

### 1. Dispatch optimization → tech routing

```
Cron routine every 30 min during dispatch hours →
  1. GET /dispatch/v2/tenant/{tenant_id}/non-job-appointments (unbooked
     window) + /jpm/v2/tenant/{tenant_id}/appointments (today's booked)
  2. For each pending dispatch decision:
       Score candidate techs by:
         - skill match for the job's tags
         - current location distance to job address
         - truck inventory match for likely parts needed
         - current vs target utilization for the day
       Assign the highest-scoring tech (or surface ranked options
       to the dispatcher in their UI rather than auto-assigning).
  3. SMS the tech with the assignment + job details.
  4. SMS the customer with the assigned tech's ETA + name.
```

### 2. Job completed → invoice + review request

```
ServiceTitan webhook on job.completed → Routine fires →
  1. GET /jpm/v2/tenant/{tenant_id}/jobs/{job_id} for line items + tech
  2. POST /accounting/v2/tenant/{tenant_id}/invoices to generate invoice
     (or it may already exist — query first)
  3. Trigger payment collection (Stripe link, in-app payment, etc.)
  4. POST QBO entries mirroring the invoice (see quickbooks-online skill);
     match revenue to the Business Unit GL accounts the operator uses
  5. Schedule cron 24h after job:
       SMS the customer: "How was {tech}? Review us on Google: {link}"
       (Or email via Mailchimp/SendGrid for written-preference customers)
  6. If review submitted, post a Slack celebration to the tech's channel.
```

### 3. Membership renewal cadence

```
Cron routine daily →
  1. GET /memberships/v2/tenant/{tenant_id}/customer-memberships
     filter: renewal_date within next 60 days, status = active
  2. At 60 days: SMS the customer a renewal offer + the value summary
                 ("Your plan saved you $X this year")
  3. At 30 days: phone call routine — surface to CSR queue
  4. At 7 days: final reminder + retention offer (e.g. lock in current
                price for 2 years)
  5. On lapse: enroll in win-back sequence (Mailchimp/Klaviyo)
                + tag in HubSpot for sales follow-up.
```

### 4. Technician scorecard

```
Cron routine daily at 6am →
  1. GET /jpm jobs completed yesterday + appointments
  2. For each tech, compute:
       jobs_completed, revenue_generated, average_ticket,
       callback_rate (jobs where customer called back within 30 days),
       customer_rating_avg (from review submissions)
  3. Write to the workspace's scorecard table
  4. Post a Slack summary to each tech's DM:
       "Yesterday: 8 jobs, $4,200 revenue, 4.9 avg rating. Top job: ..."
  5. Surface team-wide leaderboard in a #service-floor channel.
```

### 5. Inventory replenishment

```
Cron routine daily at end of dispatch day →
  1. GET /inventory/v2/tenant/{tenant_id}/truck-inventory snapshots
  2. For each truck, compare against min-stock-level rules per SKU
  3. For SKUs below min: add to a daily replenishment list per warehouse
  4. POST to the warehouse's pull-list system or Slack channel:
       "Tomorrow morning loadout for {tech.name}'s truck:
        - 5x Capacitor 35/5
        - 2x Condensate Pump
        - 10x Filter 16x25x1"
  5. Optionally auto-PO to vendor when warehouse stock low (with human
     approval step for orders above a threshold).
```

### 6. Marketing attribution

```
Cron routine weekly →
  1. GET completed jobs from last 30 days with campaign_id populated
  2. Aggregate by campaign:
       gross_revenue, gross_margin, jobs_count, average_ticket
  3. Compare against campaign spend (from Google Ads, Meta, mailer
     vendor invoices in QBO)
  4. Compute campaign-level ROI
  5. Post to workspace marketing dashboard + Slack #marketing summary:
       "Last month: 'Spring Tune-Up Direct Mail' generated 47 jobs,
        $89K revenue, 7.4x ROAS — keep running."
```

## Idempotency

ServiceTitan does not expose an idempotency-key header. For writes:
- Invoice creation: query for an existing invoice on the job before POSTing
- Customer + Location upserts: query by email/phone + address before creating
- For Estimates/Jobs created from external triggers: store the AutoFlow correlation ID in the job's `summary` or `customFields` and check before creating

## Webhooks

ServiceTitan publishes webhooks via their Connect program. Subscribe via integration setup (managed in the tenant's admin UI, not always API-exposed). Common topics:
- `Job_Completed`, `Job_Canceled`, `Job_Created`
- `Invoice_Created`, `Invoice_PaymentReceived`
- `Customer_Created`, `Customer_Updated`
- `Membership_Created`, `Membership_StatusChanged`
- `Appointment_Created`, `Appointment_Reassigned`

Signature verification: webhook headers include an HMAC signature. **Verify before processing.**

Replay safety: events carry stable IDs; dedupe on AutoFlow side.

For events that aren't pushed, fall back to **polling** ServiceTitan's GET endpoints with `modifiedOnOrAfter` filters.

## Rate limits

ServiceTitan publishes per-app-key rate limits in their developer portal:
- **20 requests/second** sustained per app key per tenant (typical baseline)
- Burst budgets allow short spikes
- 429 returns standard `Retry-After`
- Heavy reporting routines (scorecards, marketing attribution) should run off-peak

## What this skill does NOT cover

- **ServiceTitan Marketing Pro** (their integrated marketing add-on) — overlaps with Mailchimp/Klaviyo; pick one.
- **ServiceTitan Phones** (their CallSource-integrated phone system) — adjacent product; AutoFlow integrates via webhooks to the standard Call entity.
- **Fleet GPS** — supported but managed in ServiceTitan UI; not a core skill surface.
- **Pricebook authoring** — the menu of services + parts is set by the operator's office staff in the UI.

## References

- API: https://developer.servicetitan.io/
- Auth: https://developer.servicetitan.io/docs/auth/
- Tenant scope: https://developer.servicetitan.io/docs/working-with-tenants/
- AutoFlow integration shape: `src/ticketSync/` (app_key + per-tenant OAuth client-credentials + secrets-store; 30-min token TTL re-mint pattern)
