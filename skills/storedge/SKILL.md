---
name: storedge
description: Use this skill when an AutoFlow agent needs to read or write data in storEDGE (now part of Storable) — the property-management platform for self-storage facilities. Pull units / tenants / leases / payments / rentals, react to rental and payment events, push revenue to QuickBooks, automate move-in/move-out routines, manage delinquency + lien processes, run occupancy + rate management. Covers storEDGE's API + auth, the Facility / Unit / Tenant / Lease / Payment / Auction model, self-storage-specific compliance (state lien laws, eviction/auction procedures, insurance requirements, military protections under SCRA), and the workflow shape AutoFlow customers reach for (rental → onboarding, payment cadence, delinquency escalation ladder, auction routine when permitted).
---

# storEDGE — self-storage facility management

storEDGE (a Storable product) is the dominant property-management platform for AutoFlow's self-storage SMBs — independent self-storage facilities, small portfolios (2-20 facilities), boat/RV storage, climate-controlled storage, business storage. Competes with SiteLink (Storable's other major SMS), Easy Storage Solutions, and Yardi Self Storage at the small/mid end.

Use storEDGE when the customer operates **self-storage facilities** with online rental + automated billing. For commercial property management → AppFolio. For traditional residential property management → Buildium. The operational shape differs: self-storage has continuous month-to-month occupancy, low-touch customer relationships, but heavy delinquency + auction operations.

## When to reach for this skill

- **New rental** → online or in-person → onboarding routine, gate-code provisioning, autopay setup.
- **Monthly rent due** → automated billing run, autopay processing, decline handling.
- **Delinquency escalation** → state-law-driven notice cadence ending in lien sale / auction (if allowed and unresolved).
- **Move-out** → unit inspection, deposit reconciliation, gate-code revocation.
- **Vacancy + listing** → mark unit available + push to web channels (own site + aggregators like SpareFoot).
- **Rate management** — periodic rent increases on tenured tenants per local market.
- **Insurance / tenant protection** — track which tenants have storEDGE's tenant protection vs declined coverage.
- **Auction routine** — for delinquent units where state law permits and notice deadlines have run.

## Authentication

storEDGE uses **API key + Facility ID** authentication via Storable's partner program:

```
Authorization: Bearer <storedge-api-key>
X-Facility-Id: <facility-id>
```

Keys are issued per partner integration; facility-scoping is required because operators with multi-facility portfolios have separate facility records.

Base URL: `https://api.storedgefms.com/` (verify per current Storable docs — paths may have unified post-merger)

Multi-facility portfolios: AutoFlow connection record stores `(facility_id, partner_key)` per connection; portfolio-level reporting joins across facilities.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Facility | A single storage location | Top-level scope |
| Unit | A storage unit (10x10, climate-controlled, drive-up, etc.) | The leasable atomic object |
| Unit Type | Template (size, features, base rate) | Many units of same type per facility |
| Tenant | The renter | One tenant can rent multiple units |
| Lease | The rental agreement | Month-to-month typical |
| Payment | Money received | Card, ACH, check, cash, money order |
| Autopay | Recurring payment method on file | Enrollment optional but common |
| Delinquency Status | The tenant's payment current/late state | Drives escalation routine |
| Lien Process | Legal sequence after delinquency exceeds state threshold | State-specific |
| Insurance | Tenant protection / liability insurance | storEDGE or third-party |
| Gate Code | Tenant's access code | Provisioned at rental, revoked at move-out or lien |
| Auction | Final-stage delinquency disposition | Legal sale of contents |
| Income Adjustment | Discount, late fee, write-off | Revenue line |
| Move-In / Move-Out | Lifecycle events | Trigger gate + admin routines |

## Common AutoFlow workflows

### 1. New rental → onboarding

```
Webhook on rental.created (online or in-person → entered in storEDGE) →
Routine fires →
  1. Send confirmation email + SMS:
       "Welcome to {facility.name}! Your unit: {unit.number}. 
        Gate code: provided separately for security.
        First payment: ${amount} due {date}."
  2. Provision the gate code (either auto-generated or assigned from
     pool). Send via separate secure channel (e.g. branded portal
     link rather than SMS).
  3. Encourage autopay enrollment:
       "Set up autopay to never miss a payment: {link}"
       (Industry benchmark: 60-70% of new rentals on autopay reduces
        delinquency operations dramatically.)
  4. Schedule cron 7d before first payment: payment reminder
  5. Schedule cron 14d after move-in: satisfaction check.
```

### 2. Monthly billing run

```
Cron routine on the 1st of each month →
  1. For each active lease:
       Generate invoice for the month's rent + any prorated extras
       If autopay enrolled: charge the saved method
       If not autopay: SMS reminder + email with payment portal link
  2. On autopay decline:
       SMS: "Your autopay didn't process. Update payment method here:
              {link}"
       Schedule retry routine (1d, 3d, 7d)
  3. On payment received: post to lease, update delinquency clock to 0
  4. POST QBO entries:
       Debit Bank/AR
       Credit Rental Revenue
       Credit Late Fees (if assessed)
```

### 3. Delinquency escalation ladder (state-law-driven)

```
Cron routine daily →
  1. Identify leases by days-past-due. Escalation cadence is STATE-
     SPECIFIC; the workspace settings should hold the state's
     timeline. Typical pattern:
       Day 1: friendly SMS reminder + grace
       Day 5-7: late fee per lease + harder reminder
       Day 15: pre-lien notice via mail (state-required form)
       Day 30: lien notice via certified mail (state-required)
       Day 60-90: gate code disabled (per lease terms)
       Day 60-90: auction-eligible if all state notice requirements met
  2. NEVER advance to lien/auction without verifying:
       - All state-required notices have been sent + documented
       - Required notice periods have elapsed
       - No active military service (Servicemembers Civil Relief Act —
         SCRA — protects active-duty service members from default
         judgments + auctions on most rentals)
       - No active bankruptcy (filing pauses all collection)
       - Surface to facility manager for verification before any
         auction setup
  3. Lien laws are state-specific + technically nuanced; getting
     them wrong creates legal exposure for the operator. Always
     route to manager + operator's attorney for actual lien-stage
     decisions.
```

### 4. SCRA (military) verification

```
Triggered when escalating delinquency toward lien stage →
  1. Query SCRA database (military.gov public records lookup) by
     tenant name + SSN (if available)
  2. If active-duty service confirmed:
       PAUSE lien process — SCRA protection prevents default actions
       Notify facility manager: "SCRA-protected tenant: {name}. 
                                  Manual handling required."
       Document the protection in lease record
  3. SCRA protections last for the duration of active service +
     typically 30 days afterward. Refresh check periodically.
  4. Violating SCRA = significant federal liability for the operator.
```

### 5. Move-out → cleanup + relisting

```
Move-out event → Routine fires →
  1. Schedule unit inspection task for facility staff
  2. On inspection complete:
       Process any final charges (damage, missed payment)
       Apply security deposit if held
       Disable gate code
       Mark unit available
  3. Push unit to listing channels:
       Facility's own website
       SpareFoot (aggregator) if listed
       Other channels per facility's strategy
  4. Notify any waitlist for this unit type.
  5. POST QBO entries for any final reconciliation.
```

### 6. Rate management

```
Cron routine monthly →
  1. For each unit type at facility, compare current market rate
     against in-place tenants' rates:
       Tenants paying significantly below market for >12mo are
       candidates for rate increase
  2. Per facility policy + local market:
       Schedule rate-increase notice (typically 30-60d notice
       required per state)
       Send notice via mail (state-required form often)
       SMS/email follow-up
  3. NEVER apply rate increase without proper notice — that's a
     lease violation by the operator.
  4. Track rate-increase acceptance vs move-out rate (the rate
     elasticity by market + tenant tenure).
```

### 7. Auction routine (when permitted + all-clear)

```
Triggered only after delinquency-escalation verifies:
  - All notice periods elapsed
  - No SCRA protection
  - No bankruptcy stay
  - Facility manager + attorney sign-off
→
  1. Schedule the auction per state law (typically online via Storage
     Auctions, StorageTreasures; some states require in-person)
  2. List the unit's contents for auction
  3. Track auction proceeds:
       Proceeds first cover unpaid rent + lien-process costs
       Excess (if any) typically owed back to former tenant (state-
       specific; some states allow facility to keep)
  4. Post-auction: clear out unit, return to inventory
  5. Auctions are heavily regulated and often litigated; AutoFlow
     surfaces deadlines + tracks documentation but the decisions
     remain with humans.
```

## Self-storage-specific compliance

- **State lien laws** vary widely — notice timelines, required notice content, notification methods (mail vs publication), grace periods, auction procedures. Storable maintains state-specific templates; AutoFlow tracks deadlines per state config.
- **SCRA (Servicemembers Civil Relief Act)** — federal law protects active-duty military from default judgments + auctions. Verification before any lien action is non-negotiable.
- **Bankruptcy stay** — when a tenant files bankruptcy, an automatic stay halts all collection activity. Continuing collection violates federal law.
- **Insurance requirements** — many leases require tenant insurance (tenant protection); track which leases have it.
- **Hazardous storage** — units shouldn't contain explosives, hazardous waste, perishables. Surface concerns to facility staff.
- **Gate-code security** — codes are sensitive (a stolen code = access to someone's belongings). Never transmit codes over insecure channels; use portal links or in-person delivery.

## Idempotency

storEDGE's API supports idempotency on payment + lease writes. For routine-driven writes, use deterministic keys.

For tenant + lease upserts, dedupe by email + phone before creating.

## Webhooks

storEDGE/Storable publishes webhooks for major events:
- `rental.created`, `rental.modified`
- `payment.completed`, `payment.failed`, `payment.refunded`
- `lease.delinquent`, `lease.in_lien`
- `move_out.completed`
- `unit.status_changed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

storEDGE/Storable publishes per-facility rate limits. Typically conservative; 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Boat/RV storage with marine specifics** (water/electric hookups, on-water slips) — some specialty PM platforms.
- **Climate / environmental sensor data** — separate IoT systems integrate via Storable's IoT product.
- **Web listing / SEO** — Storable's marketing products + SpareFoot integration; not skill scope.
- **Construction / development of new facilities** — separate operational concern.
- **Legal eviction proceedings** — beyond lien/auction within state law; if a tenant disputes, attorney is needed.

## References

- API: https://www.storable.com/storedge/api-documentation (per partner agreement)
- SCRA verification: https://scra.dmdc.osd.mil/scra/
- State self-storage lien laws (compendium): https://www.selfstorage.org/legal-resources
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-facility credentials; state-lien-law config at install; SCRA-verification gate on lien escalation)
