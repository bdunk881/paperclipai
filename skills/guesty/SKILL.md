---
name: guesty
description: Use this skill when an AutoFlow agent needs to read or write data in Guesty — the property-management + channel-management platform for short-term + vacation rental operators (Airbnb hosts, VRBO operators, Vrbo + Booking.com property managers, vacation-rental property managers running 5-500+ listings). Pull listings / reservations / guests / messages / payments / cleaners, react to booking and check-in/out events, push revenue to QuickBooks, automate guest-messaging cadences across channels, manage cleaner scheduling, run dynamic pricing, and reconcile OTA payouts. Covers Guesty's REST API + OAuth, the Account / Listing / Reservation / Guest / Channel / Payment / Cleaner model, vacation-rental-specific considerations (channel parity, occupancy taxes by jurisdiction, security deposits, vacation-rental licensing requirements), and the workflow shape AutoFlow customers reach for (booking → pre-arrival → check-in → check-out → review, dynamic pricing, channel sync, OTA payout reconciliation).
---

# Guesty — short-term + vacation rental management

Guesty is the leading property-management + channel-management platform for AutoFlow's vacation-rental SMBs — Airbnb-only hosts with multiple listings, VRBO/Vrbo operators, multi-channel vacation-rental property managers (running 5-500+ listings), boutique vacation-rental management companies. Used by operators managing ~200,000+ properties globally.

Use Guesty when the customer operates **short-term rentals on OTAs** (Airbnb, Vrbo, Booking.com, etc.). For traditional small hotels + B&Bs → Cloudbeds. For multi-family + long-term residential PM → AppFolio / Buildium.

## When to reach for this skill

- **Booking → guest-messaging cadence** — pre-arrival info, check-in instructions, in-stay support, check-out reminders, review request.
- **Channel parity + sync** — keep rates + availability consistent across Airbnb, Vrbo, Booking.com, direct site.
- **Dynamic pricing** — daily rate adjustments based on demand, events, comp set.
- **Cleaner / housekeeping scheduling** — automated cleaner assignment per reservation, prep+ post-checkout routines.
- **OTA payout reconciliation** — match Airbnb/Vrbo/Booking.com statements against in-Guesty revenue + fees + taxes.
- **Guest screening + risk** — flag high-risk bookings for manual review.
- **Security deposits + damage** — collection, return, claim management.
- **Occupancy tax reporting** — varies wildly by jurisdiction; rendering correctly to QBO matters.
- **Owner reporting** — for property managers managing on behalf of owners, monthly statements + commissions.

## Authentication

Guesty uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <guesty-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

Base URL: `https://open-api.guesty.com/v1/`

Account-scoped: each operator's Guesty account has its own scope. For multi-account property managers, AutoFlow connections pin per-account.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Account | The operator's Guesty workspace | Top-level scope |
| Listing | A rental property/unit | Includes photos, amenities, rules |
| Listing Group | Cluster of related units (apt-hotel) | Some operators use |
| Reservation | A guest booking | Cross-channel central record |
| Guest | The booking customer | One per reservation typically |
| Channel | Booking source (Airbnb, Vrbo, Booking.com, Direct, etc.) | Per-channel quirks |
| Inquiry | Pre-booking message from guest | Pre-reservation conversation |
| Message | Communication thread (channel-native or unified inbox) | Heavy use |
| Calendar | Per-listing availability + rates | Source for channel-manager |
| Pricing Rule | Rate-setting rule | Dynamic pricing engine |
| Cleaner | Housekeeping resource | Assigned to checkout cleanings |
| Cleaning Task | A specific cleaning job | Triggered by checkout |
| Owner (Property Owner) | The owner of a listing | For property managers, the owner-reporting recipient |
| Reservation Payment | Money received | Per-channel payment models vary |
| OTA Payout | Statement-level payout | For reconciliation |
| Tax | Occupancy tax record | Per-jurisdiction |

## Common AutoFlow workflows

### 1. Booking → pre-arrival cadence

```
Webhook on reservation.created → Routine fires →
  1. Send guest welcome message via the unified inbox (or Airbnb-native
     for Airbnb bookings — channel rules vary on direct contact):
       Thank you + confirmation
       Property address (if Airbnb: reveal on day-before per their rules)
       Self-check-in instructions (if applicable)
       House manual link
       Contact info for issues
  2. Cron 3 days before arrival:
       Reminder + arrival logistics
       Survey for "anything special?" (special occasions, dietary, etc.)
  3. Cron 1 day before arrival:
       Self-check-in code + door instructions
       Wi-Fi password
       Parking info
       Local recommendations (pre-arranged via property dashboard)
  4. Day of arrival:
       Mid-day SMS: "Looking forward to hosting you! Check-in opens at
                     {time}. Anything we can prepare?"
  5. Critical: respect channel rules. Airbnb prohibits steering guests
     off-platform; messaging must stay within their guidelines.
```

### 2. Channel sync + parity

```
Continuous routine →
  1. Pull Guesty's master rates + availability for next 365d
  2. For each connected channel, verify rates + inventory match
  3. If mismatch:
       Channel showing wider availability than Guesty → close window
       (overbooking risk; auto-close + alert)
       Channel showing higher rate than Guesty → fine (operator may
       intend price-discrimination by channel)
       Channel showing LOWER rate than Guesty → URGENT (rate parity
       violation; many channels have parity clauses — page operator)
  4. Use Guesty's channel-manager push for corrective action;
     don't bypass to direct OTA writes.
```

### 3. Dynamic pricing routine

```
Cron routine daily →
  1. Pull market comps + demand signals:
       Local event calendar (sports, conferences, festivals)
       Day-of-week patterns
       Booking pace (how fast inventory is filling vs prior year)
       Competitor rate sampling (comp-set)
  2. Compute daily rate adjustments per listing:
       Floor: operator-set minimum (don't go below)
       Ceiling: operator-set maximum (don't price out market)
       Demand uplift: +X% for high-demand dates
       Last-minute discount: -X% if inventory not moving 2-3 days out
  3. Push updated rates to Guesty (which syncs to channels)
  4. Surface significant changes (>15% delta) to operator for
     awareness; never auto-apply silently for high-stakes shifts.
  5. Dynamic pricing tools (PriceLabs, Beyond) usually handle this;
     AutoFlow's role is orchestration if customer doesn't use a
     dedicated tool.
```

### 4. Cleaner / housekeeping scheduling

```
Webhook on reservation.checked_out OR cron daily →
  1. For each checkout today:
       Assign cleaner per:
         - Cleaner availability + next-booking timing
         - Property zone (geographic clustering for efficiency)
         - Cleaner ratings on this property type
         - Same-day-turnover constraints (back-to-back bookings need
           tight turnaround)
       Send cleaner the assignment via SMS:
         "Cleaning: {listing.name} at {address}. Check-out: {time}.
          Next check-in: {time}. {special_instructions}"
  2. After cleaning + photo upload (cleaner submits via Guesty app):
       Verify completion photo presence
       Pass-through quality check (operator reviews random sample)
       Pay the cleaner per cleaning rate
```

### 5. OTA payout reconciliation

```
Cron routine when statements arrive (Airbnb weekly, Vrbo monthly, etc.) →
  1. Parse the OTA payout statement
  2. For each line item, match to Guesty reservation:
       Expected: total - ota_fee - tax_remitted_by_OTA = net_payout
       Actual: from statement
  3. If discrepancy > tolerance: surface to operator for dispute
  4. POST QBO entries:
       Debit Bank (payout received)
       Debit OTA Service Fees expense (per channel)
       Credit Rental Revenue (per reservation)
       Track remitted-by-OTA taxes separately from owe-by-host taxes
```

### 6. Guest screening + risk routine

```
Webhook on inquiry.created (pre-booking) → Routine fires →
  1. Score the inquiry for risk signals:
       Guest profile completeness (no photo, no reviews — higher risk)
       Stated party size vs listing capacity
       Local guest (within 50 miles — often party rental risk)
       Last-minute large group bookings (common party-rental flag)
       Suspicious message content (party keywords)
  2. For high-risk: surface to operator for manual approval before
     accepting
  3. For Airbnb: AutoFlow can use Airbnb's preapproval/decline flow
  4. NEVER auto-decline based on protected-class proxy data — fair
     housing applies even to short-term rentals in some jurisdictions.
```

### 7. Owner reporting (for property managers)

```
Cron routine on the 1st of each month →
  1. For each managed property:
       Pull prior month's bookings, revenue, fees, taxes, expenses
       Compute owner distribution:
         gross_revenue - PM_commission - cleaning_fees - maintenance -
         OTA_fees = owner_net
  2. Generate owner statement
  3. Email + portal-post the statement
  4. Process the distribution (ACH typical, monthly)
  5. POST QBO entries:
       Owner liability
       PM commission revenue
  6. Owner relationship quality drives retention — clear statements +
     prompt distributions matter.
```

## Vacation-rental-specific compliance

- **Local short-term-rental licensing** — many cities/counties require permits + license fees (NYC, SF, Boston, others). Tracking renewals + posting permit numbers per listing where required.
- **Occupancy taxes** — vary wildly: some collected by OTA, some collected + remitted by operator. Common errors: double-remitting, missing the right tax for the jurisdiction.
- **Channel rules** — Airbnb has strict rules on guest contact (no steering off-platform, no direct asks for off-platform payments). Vrbo + Booking.com have different rules. AutoFlow routines respect per-channel.
- **Fair housing** — STRs in some jurisdictions are covered by fair housing laws (CA prohibits short-term-rental discrimination based on race, religion, etc.).
- **Security deposits + damage claims** — process for damage-claim filing varies by channel (AirCover for Airbnb, Vrbo Damage Coverage, etc.).
- **Co-host arrangements** — multi-party ops with co-hosts require clarity on who controls what.

## Idempotency

Guesty's API supports idempotency on reservation + payment writes. For routine-driven writes, use deterministic keys.

For guest upserts, dedupe by email before creating.

## Webhooks

Guesty publishes webhooks for major events:
- `reservation.created`, `reservation.canceled`, `reservation.checked_in`, `reservation.checked_out`
- `inquiry.created`
- `message.received`
- `payment.completed`
- `task.completed` (cleaning, maintenance)

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Guesty publishes per-account rate limits. Typically conservative for periodic syncs; 429 with `Retry-After`. Heavy operations (full-year channel sync) off-peak.

## What this skill does NOT cover

- **Dynamic pricing engines as standalone** (PriceLabs, Beyond, Wheelhouse) — separate tools many operators layer; Guesty integrates with them.
- **Smart lock provisioning** (RemoteLock, Schlage Encode) — separate IoT tools.
- **In-stay support outsourcing** (Hostfully, Lodgify on-call) — separate vendor agreements.
- **Hospitality SOPs / cleaning standards documentation** — operator-owned.
- **Property purchase + acquisition decisions** — separate workflow.

## References

- API: https://docs.guesty.com/
- Channel rules (vary): Airbnb host rules, Vrbo policies, Booking.com partner help
- Local STR licensing (varies wildly): check city/county requirements
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-account credentials; channel-rule-aware messaging; tax-jurisdiction breakdown preserved in QBO)
