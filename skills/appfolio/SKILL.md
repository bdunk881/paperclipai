---
name: appfolio
description: Use this skill when an AutoFlow agent needs to read or write data in AppFolio Property Manager — the platform for residential + commercial property management companies. Pull units / tenants / leases / work orders / owner statements, react to maintenance and leasing events, push rent and expense data to QuickBooks, manage tenant communications, track move-in/move-out. Covers AppFolio's reporting API + auth model, the Property / Unit / Tenant / Lease / WorkOrder / Owner model, trust-accounting + fair-housing compliance discipline, and the workflow shape AutoFlow customers reach for (maintenance request → vendor dispatch, lease expiring → renewal routine, rent posted → owner-statement reconciliation).
---

# AppFolio Property Manager — property management

AppFolio is the dominant property-management platform for AutoFlow's mid-market real-estate-operations SMBs — residential property managers (50-5,000 units), small commercial portfolios, mixed-use, student housing, HOA/community management. It owns the units + tenants + leases + maintenance + accounting + owner-reporting surface that property management companies run on daily.

Use AppFolio when the customer **manages occupied real estate on an ongoing basis** (collecting rent, handling maintenance, reporting to owners). For transactional real estate (buying/selling) → dotloop. For commercial deal pipelines → dealcloud.

## When to reach for this skill

- **Maintenance request** → vendor dispatch routine, tenant acknowledgment, work-order tracking.
- **Lease expiring** → renewal offer routine (60/30-day cadence), rent-increase calculation.
- **Rent posted / received** → owner-statement reconciliation, QuickBooks sync, late-fee assessment on overdue.
- **Move-in / move-out** → checklist routine, deposit accounting, unit-turn coordination.
- **Owner statement period close** → generate + distribute owner statements, push the management-fee revenue to QBO.
- **Delinquency** → escalation routine (notice generation, payment-plan offer, eventual eviction-filing coordination).
- **Vacancy** → listing syndication trigger, showing-scheduling coordination.

## Authentication

AppFolio's primary integration surface is the **Reporting API** (data export) plus a more limited write API for specific objects. Auth is via **API client credentials** (client ID + secret) issued per AppFolio database:

```
Authorization: Basic base64(<client-id>:<client-secret>)
```

The client credentials are scoped to one AppFolio database (one property-management company). Multi-database operators (e.g. a PM company managing several legal entities) need separate credentials per database.

Base URL: `https://{company-domain}.appfolio.com/api/v2/` (the company subdomain is part of the URL — capture it at install).

**Note on API maturity**: AppFolio's public write API is narrower than its read/reporting API. Many workflows are read-heavy (pull data, act in other systems) rather than write-back-to-AppFolio. Where write-back isn't supported, AutoFlow surfaces the action to a human in AppFolio's UI rather than attempting an unsupported mutation.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Property | A building or community | Has many units |
| Unit | A rentable space | The atomic leasable object |
| Tenant | A renter (occupant) | Linked to a lease |
| Lease | The rental agreement | Start/end, rent, deposit, terms |
| Work Order | A maintenance request | Tenant-reported or PM-initiated |
| Vendor | A maintenance contractor | Assigned to work orders |
| Owner | The property owner (PM's client) | Receives statements + distributions |
| Owner Statement | Period financial report to an owner | Income − expenses − management fee |
| GL Transaction | A general-ledger accounting entry | Trust accounting |
| Bill | A payable (vendor invoice) | Charged against a property |

## Common AutoFlow workflows

### 1. Maintenance request → vendor dispatch

```
AppFolio Reporting API poll (every 15 min) for new work orders OR
inbound tenant maintenance form → Routine fires →
  1. Read work order: unit, tenant, category, description, urgency
  2. LLM triage: classify urgency + category, estimate vendor type needed
  3. Match to a preferred vendor (from a workspace vendor list by
     category + property region)
  4. SMS the vendor via Twilio with the work order details + property access
  5. SMS the tenant: "We've received your request and dispatched {vendor}.
     Expected contact within {SLA}."
  6. Track the work order to completion; escalate if SLA breached.
  Note: if AppFolio write-API supports work-order status updates, sync
  back; otherwise surface to the PM in AppFolio UI.
```

### 2. Lease expiring → renewal routine

```
Cron routine daily →
  1. Reporting API: query leases where end_date within 90 days,
     status = active, no renewal in progress
  2. At 60 days out:
       Compute the renewal rent (current + market-adjustment %, per
       workspace config or a comp lookup)
       Generate a renewal offer (DocuSign template, see docusign skill)
       SMS + email the tenant the offer
  3. At 30 days out, if no response:
       Reminder + Slack alert to the leasing agent
  4. On signed renewal: update HubSpot, schedule the new lease term.
```

### 3. Rent received → owner-statement reconciliation

```
Cron routine on rent-due-day +1 →
  1. Reporting API: pull the day's rent receipts by unit
  2. Match against expected rent roll; flag underpayments + non-payments
  3. For non-payments: fire the delinquency routine (workflow 6)
  4. Aggregate by owner for the owner-statement period:
       gross_rent − maintenance − management_fee = owner_distribution
  5. POST QBO entries:
       Credit Rental Income (per property)
       Debit Management Fee Revenue (the PM's cut)
       Track owner liability for the distribution
```

### 4. Move-out → deposit accounting + unit turn

```
AppFolio move-out event (or scheduled lease-end) → Routine fires →
  1. Create a unit-turn checklist (clean, inspect, repair, re-list)
  2. Compute deposit disposition:
       deposit − documented damages − unpaid rent = refund
  3. Generate the deposit-disposition statement (legally required in
     most states within N days — surface the deadline)
  4. Schedule the refund payment + notify the former tenant
  5. Trigger the vacancy/listing routine (workflow 7).
```

### 5. Owner statement period close → distribute

```
Cron routine on the 1st of each month →
  1. Reporting API: pull each owner's income + expenses for prior month
  2. Generate owner statements (PDF per owner)
  3. SendGrid email each owner their statement (transactional)
  4. POST QBO entries for management-fee revenue recognition
  5. Schedule owner distributions (ACH) per the management agreement.
```

### 6. Delinquency → escalation ladder

```
Triggered by workflow 3's non-payment flag →
  1. Day 1 past due: friendly SMS reminder + late-fee notice per lease
  2. Day 5: formal notice (state-specific template — pay-or-quit in
     many states); generate via DocuSign, deliver per legal requirements
  3. Day 10: payment-plan offer routine OR escalate to the PM for
     eviction-filing decision (NEVER auto-file — eviction is a legal
     action requiring human + often attorney involvement)
  4. Log every step to the compliance audit trail.
```

## Property-management compliance discipline

PM operations are subject to **trust accounting, fair housing, security-deposit law, and eviction procedure** — all state-specific and high-stakes:

- **Trust accounting**: tenant deposits + owner funds are held in trust, never commingled with the PM's operating funds. Mirror to a separate QBO trust account (same discipline as the Clio skill's IOLTA handling).
- **Security deposits**: state law dictates the timeline (often 14-30 days post-move-out) and itemization requirements for returning deposits. Surface deadlines; never let a refund slip silently.
- **Fair housing**: tenant communications + screening must not discriminate on protected classes. AutoFlow routines that draft tenant messaging must avoid any language touching familial status, disability, national origin, etc. When in doubt, route to human review.
- **Eviction**: never automate an eviction filing. AutoFlow can prepare notices + track deadlines, but the decision + filing is a legal action requiring human (often attorney) involvement.

## Idempotency

AppFolio's write surface is narrow; for the writes AutoFlow does perform, dedupe via natural keys (work-order ID, lease ID). Most workflows are read-from-AppFolio + act-in-other-systems, so idempotency lives in the downstream systems (QBO, DocuSign, Twilio) which have their own keys.

## Webhooks

AppFolio's webhook support is **limited** as of 2026 — most integrations poll the Reporting API on a cron rather than receiving push events. AutoFlow's pattern:
- Poll the Reporting API every 15 min for time-sensitive objects (work orders, payments)
- Poll daily for slower objects (leases, owner statements)
- Use `updated_since` filters for incremental sync

If AppFolio enables webhooks for the customer's plan tier, prefer them; otherwise polling is the reliable path.

## Rate limits

- The Reporting API is designed for periodic bulk export, not high-frequency polling. Respect a conservative cadence (every 15 min minimum interval for the same report).
- 429 / throttle responses: back off aggressively. AppFolio is a system of record; don't hammer it.

## What this skill does NOT cover

- **AppFolio Investment Management** (their fund-management product) — separate platform.
- **Tenant screening** (credit/background checks) — runs through AppFolio's screening partners; results land in AppFolio but the screening itself is regulated (FCRA) and not AutoFlow's to automate.
- **Listing syndication** (Zillow, Apartments.com) — AppFolio syndicates natively; AutoFlow triggers the vacancy routine but doesn't post listings directly.
- **AppFolio Stack / AI leasing** — their native AI features; don't duplicate.

## References

- API: https://www.appfolio.com/help/api
- Reporting API: https://{company}.appfolio.com/api/v2/reports (per-database)
- Fair housing (HUD): https://www.hud.gov/program_offices/fair_housing_equal_opp
- AutoFlow integration shape: `src/ticketSync/` (api_key / basic-auth + secrets-store; per-database credentials; company subdomain captured at install; trust-account separation in QBO)
