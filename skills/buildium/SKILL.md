---
name: buildium
description: Use this skill when an AutoFlow agent needs to read or write data in Buildium — the property-management platform for small-to-mid residential property managers, community associations (HOAs), and self-managing landlords. Pull rentals / units / leases / tenants / work orders / association data, react to maintenance and payment events, sync to QuickBooks, manage tenant + owner communications, track association dues. Covers Buildium's REST API v1 with API-key auth, the Rental / Unit / Lease / Tenant / Owner / Association model, trust-accounting + fair-housing discipline, and the workflow shape AutoFlow customers reach for (maintenance → vendor dispatch, rent received → owner reconciliation, association dues → delinquency tracking).
---

# Buildium — property + association management

Buildium is the dominant property-management platform for AutoFlow's small-to-mid residential property managers and **community associations (HOA / COA)** — the segment slightly below AppFolio's mid-market sweet spot, plus the association-management niche that AppFolio serves less directly. Self-managing landlords, boutique PM companies (under ~500 units), and HOA management firms run on it.

Use Buildium when the customer is a **smaller PM operation or manages community associations**. For larger residential/commercial portfolios → AppFolio. For real estate transactions → dotloop.

The **association-management** capability is Buildium's differentiator worth noting: HOA/COA management (dues collection, board communications, violation tracking, architectural-review requests) is a distinct workflow set from rental management.

## When to reach for this skill

**Rental management:**
- **Maintenance request** → vendor dispatch + tenant acknowledgment.
- **Rent received / overdue** → owner reconciliation, late-fee assessment, delinquency escalation.
- **Lease expiring** → renewal routine.
- **Move-in/move-out** → checklist + deposit accounting.

**Association management:**
- **Dues posted / received** → delinquency tracking, owner-ledger reconciliation.
- **Violation reported** → notice generation + cure-period tracking.
- **Architectural-review request** → board-routing + decision-tracking routine.
- **Board meeting** → agenda prep, minutes distribution.

## Authentication

Buildium uses **API key + secret** authentication:

```
x-buildium-client-id: <client-id>
x-buildium-client-secret: <client-secret>
```

Keys are issued in the Buildium account's API settings and scoped to one Buildium account. Multi-account operators need separate credentials per account.

Base URL: `https://api.buildium.com/v1/`

API access requires the customer's Buildium plan to include API access (a paid add-on on some tiers) — confirm at install.

## Core entity model

| Entity | What it is | Domain |
|---|---|---|
| Rental (Property) | A rental building/property | Rental mgmt |
| Rental Unit | A leasable unit | Rental mgmt |
| Lease | The rental agreement | Rental mgmt |
| Tenant | The renter | Rental mgmt |
| Rental Owner | The property owner (PM's client) | Rental mgmt |
| Work Order | Maintenance request | Both |
| Vendor | Maintenance contractor | Both |
| Association | An HOA/COA | Association mgmt |
| Association Unit | A unit/home in the association | Association mgmt |
| Association Owner | A homeowner/member | Association mgmt |
| Ownership Account | The owner's financial ledger (dues) | Association mgmt |
| GL Account / Entry | Accounting | Both |
| Bill | A payable | Both |

## Common AutoFlow workflows

### 1. Maintenance request → vendor dispatch

```
Buildium webhook (or poll /v1/workorders?lastupdatedfrom=...) → Routine fires →
  1. GET the work order: unit, requester, category, priority
  2. LLM triage + match to a preferred vendor by category + region
  3. Twilio SMS to vendor with details; SMS tenant with acknowledgment
  4. PATCH /v1/workorders/{id} status → "In Progress" (Buildium write
     API supports work-order updates)
  5. Track to completion; escalate on SLA breach.
```

### 2. Rent received → owner reconciliation

```
Cron routine on rent-due-day +1 →
  1. GET /v1/leases/transactions?transactiondatefrom={today}
  2. Match against the rent roll; flag non-payments → delinquency routine
  3. Aggregate by rental owner for the statement period
  4. POST QBO entries (Rental Income, Management Fee Revenue, owner
     liability for distribution)
```

### 3. Association dues → delinquency tracking

```
Cron routine after the dues-due date →
  1. GET /v1/associations/ownershipaccounts/transactions for the period
  2. Identify owners with outstanding balances
  3. Escalation ladder per the association's governing documents:
       Day 1: courtesy reminder (email + portal notice)
       Day 30: formal late notice + late fee per CC&Rs
       Day 60: lien-warning notice (legal — generate via DocuSign,
               but NEVER auto-file a lien; route to the board + attorney)
  4. Log every step to the association's compliance trail.
```

### 4. Violation reported → notice + cure tracking

```
Board member or inspection routine reports a violation → Routine fires →
  1. POST a violation record (or track in a workspace table if Buildium's
     violation API is limited on the plan)
  2. Generate the violation notice (DocuSign template with the specific
     CC&R section cited)
  3. Deliver per the association's notice requirements (certified mail
     tracking, email, portal)
  4. Schedule a cure-period-end check:
       If cured → close
       If not → escalate to the board for fine/hearing decision
                (NEVER auto-fine; governance decisions need the board)
```

### 5. Move-out → deposit accounting

```
Buildium move-out event → Routine fires →
  1. Compute deposit disposition (deposit − damages − unpaid rent)
  2. Generate the disposition statement (state-law deadline applies —
     surface it; many states require 14-30 days)
  3. Schedule the refund + notify the former tenant
  4. Trigger the unit-turn + re-listing routine.
```

## Property + association compliance discipline

Same high-stakes constraints as the AppFolio skill, plus association-specific governance:

- **Trust accounting**: tenant deposits, owner funds, AND association reserve funds are held in trust — never commingled. Mirror to separate QBO trust accounts.
- **Fair housing**: tenant + applicant communications must not discriminate on protected classes.
- **Security-deposit law**: state-specific return timelines + itemization.
- **Association governance**: fines, liens, and architectural decisions are **board decisions**, not automatable. AutoFlow prepares notices + tracks deadlines + routes to the board; the board (often with counsel) decides. Auto-fining homeowners or auto-filing liens is both a legal and a reputational hazard.
- **Open-meeting / records law**: many states have HOA transparency requirements (open board meetings, member access to records). Don't automate anything that obscures records from members entitled to them.

## Idempotency

Buildium's REST API does not expose an idempotency-key header. Dedupe via natural keys (work-order ID, lease-transaction ID, ownership-account-transaction ID). For routine-driven inserts, query-then-write.

## Webhooks

Buildium supports webhooks for a growing set of events (work orders, leases, payments). Configure via the API or the account's developer settings:

```
POST /v1/webhooks
body:
  url: "https://autoflow.example/webhooks/buildium/{workspace_id}"
  events: ["WorkOrder.Created", "Lease.PaymentReceived", "Tenant.Created"]
```

Signature verification: Buildium signs with an HMAC in a signature header. **Verify before processing.** For events Buildium doesn't push, fall back to polling with `lastupdatedfrom` filters.

## Rate limits

- **10 requests/second** per API key (default).
- 429 returns standard `Retry-After`.
- Bulk reads (full rent roll, association rosters) should paginate (`offset` + `limit`) and use `lastupdatedfrom` for incremental sync.

## What this skill does NOT cover

- **Buildium's resident/owner portals** — UI layer; AutoFlow doesn't customize them.
- **Tenant screening** (FCRA-regulated) — runs through Buildium's screening partners; not AutoFlow's to automate.
- **Online lease signing** — Buildium has native e-sign; for complex docs route through DocuSign instead.
- **Buildium's accounting beyond GL export** — AutoFlow mirrors to QBO; it doesn't replace Buildium's internal books.

## References

- API: https://developer.buildium.com/
- Webhooks: https://developer.buildium.com/#section/Webhooks
- Fair housing (HUD): https://www.hud.gov/program_offices/fair_housing_equal_opp
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-account credentials; trust-account separation in QBO; board-governance human-in-the-loop guard)
