---
name: cloudbeds
description: Use this skill when an AutoFlow agent needs to read or write data in Cloudbeds — the cloud-based property-management + channel-management + booking-engine platform for small-to-mid hotels, B&Bs, hostels, vacation rentals, motels, and inns. Pull reservations / guests / rooms / rates / payments, react to booking + check-in/out events, push revenue to QuickBooks, sync rates across OTAs (Expedia, Booking.com), run guest-pre-arrival outreach, and reconcile commissions. Covers Cloudbeds's REST API + OAuth, the Property / Room / Reservation / Guest / Rate Plan / OTA model, hospitality-specific tax discipline (TOT/lodging tax, ADR/RevPAR metrics), and the workflow shape AutoFlow customers reach for (pre-arrival routine, check-in/out reconciliation, OTA payout matching, rate management).
---

# Cloudbeds — small-property hospitality management

Cloudbeds is the leading cloud-based property-management system (PMS) + channel manager + booking engine for AutoFlow's small-to-mid hospitality SMBs — independent hotels (10-200 rooms), B&Bs, hostels, vacation rentals, boutique inns, motels, glamping operators. It competes with Mews, RoomRaccoon, and StayNTouch at the small/independent end, below enterprise PMS like Opera or Maestro.

Use Cloudbeds when the customer is a **small-to-mid independent lodging property**. For high-end boutiques + enterprise → Mews/Opera. For Airbnb-only operators → Guesty / Hostfully (vacation-rental-specialty).

## When to reach for this skill

- **New reservation** → guest pre-arrival routine, ID/CC pre-auth flow, room assignment.
- **Pre-arrival** — 3-day, 1-day, and same-day-arrival outreach (PHI-free → guest comm reasonable in hospitality, no special framework).
- **Check-in** → upsell routine (room upgrade, late checkout, breakfast add-on), in-stay engagement.
- **Check-out** → final folio reconciliation, post-stay review request.
- **OTA payout reconciliation** — match Expedia/Booking.com/Airbnb statements against in-PMS revenue, account for commissions.
- **Daily revenue close** → push room nights + revenue to QBO, compute ADR / RevPAR / occupancy.
- **Rate management** — react to demand signals (high occupancy → close low-rate plans) or run promotional rate routines.
- **Channel sync** — verify rates + inventory are in sync across OTAs.

## Authentication

Cloudbeds uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <cloudbeds-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens long-lived but rotate on use.

API key auth is available for single-property direct use; OAuth is preferred for multi-property AutoFlow.

Base URL: `https://api.cloudbeds.com/api/v1.2/`

Multi-property groups: each property has its own Cloudbeds account. AutoFlow connection records pin per-property at install; brand-level reporting joins across them.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Property | A single lodging operation (hotel, B&B, hostel) | Top-level scope |
| Room | A physical room | Has a RoomType (e.g. "Standard Queen") |
| Reservation | A booking | One reservation can span multiple rooms (group bookings) |
| Guest | A person staying | Linked to reservation |
| Rate Plan | A price + conditions | Per RoomType, per date range, per channel |
| Allotment | Available inventory per RoomType per date | What channels can sell |
| Folio | Charges + payments for a reservation | Like a tab |
| Payment | A guest payment | Card, cash, OTA prepaid, gift voucher |
| Channel (OTA) | Booking source | Direct, Expedia, Booking.com, Airbnb, Google, etc. |
| Tax | Per-property tax config | Sales tax, lodging tax, city tax, tourism fees |
| Service | Add-on (breakfast, parking, spa) | Sells with or after the room |
| User | Staff member | For action attribution |

## Common AutoFlow workflows

### 1. Pre-arrival routine

```
Cron routine daily →
  1. Query reservations with check_in_date in {3 days, 1 day, today}
  2. 3-day-out outreach:
       Email via SendGrid: "Looking forward to hosting you. Let us
                            know your arrival time + any requests."
       Survey link (Typeform) for trip purpose, dietary, special occasion
  3. 1-day-out outreach:
       SMS via Twilio: "Check-in is from 3pm. Address: {property.address}.
                        Reply with ETA so we can have everything ready."
       Upsell offer: late checkout, room upgrade, breakfast pkg
  4. Same-day morning:
       SMS: "Welcome to {property}! Check-in opens at 3pm. Anything
             we can prepare?"
  5. Log all touches to the guest's reservation notes for the front desk.
```

### 2. Check-in upsell routine

```
On check_in event (or front-desk trigger) → Routine fires →
  1. Compute upsell offers:
       - Room upgrade (if higher RoomType available for the dates)
       - Late checkout (if no same-day departure crunch)
       - Breakfast pkg / spa add-on / parking
  2. Surface to front-desk in their UI; OR send a guest-app push
  3. On accept, append to folio + update room assignment if upgrade.
```

### 3. OTA payout reconciliation

```
Cron routine when monthly statements drop (cron + email-ingest) →
  1. Parse the OTA payout statement (Expedia, Booking.com, Airbnb,
     each with their own format)
  2. For each line item, match to a Cloudbeds reservation by
     confirmation code:
       Expected: net_payout = booking_total - ota_commission - taxes_remitted
       Actual: from the statement
  3. If discrepancy > tolerance: surface to revenue manager for dispute
  4. POST QBO entries:
       Debit Bank (payout received)
       Debit OTA Commission expense (per OTA)
       Credit Room Revenue (per reservation)
       Track local lodging-tax remittances separately
```

### 4. Daily revenue close + KPIs

```
Cron routine at 3am (after night audit close) →
  1. Pull yesterday's:
       arrivals, departures, in-house count, no-shows, walk-ins
       room revenue, F&B revenue, other revenue
       occupancy = occupied_rooms / available_rooms
       ADR = room_revenue / occupied_rooms
       RevPAR = room_revenue / available_rooms (or ADR * occupancy)
  2. POST QBO entries:
       Credit Room Revenue
       Credit Other Revenue lines
       Credit Tax Payable (per tax jurisdiction)
  3. Slack the manager a daily summary:
       "Yesterday: 42 in-house, 92% occ, $185 ADR, $171 RevPAR.
        Today arrivals: 18. Today departures: 12."
  4. Write to workspace KPI dashboard for trend reporting.
```

### 5. Channel sync verification

```
Cron routine every 30 min during peak hours, daily otherwise →
  1. Pull Cloudbeds's rate + allotment for the next 90 days
  2. For each connected channel (Expedia, Booking.com, etc.), pull
     the channel-side view of the same property
  3. Diff: any mismatch in rate or inventory?
     - Channel showing inventory Cloudbeds doesn't have → URGENT
       (risk of overbooking); auto-close the channel + page on-call
     - Cloudbeds rate < channel rate (rate parity violation) → alert
       revenue manager; many OTAs have parity clauses
  4. Use Cloudbeds's channel-manager push as the corrective action
     (don't directly call OTA APIs; Cloudbeds is the source-of-truth
     write surface).
```

### 6. Post-stay review request

```
Cron routine 24h after check_out → Routine fires →
  1. Email via SendGrid: "Thanks for staying! How was your visit?"
       Include direct links to Google Business Profile + TripAdvisor
       + Booking.com guest review (if booked via Booking.com)
  2. Survey via Typeform for NPS + open feedback
  3. Detractors (NPS <= 6): route to GM for personal outreach
  4. Promoters (NPS >= 9): include the direct review-platform link
     in a follow-up nudge.
```

### 7. Demand-based rate management

```
Cron routine hourly during peak windows →
  1. Pull next-90-day occupancy forecast (current bookings vs avail)
  2. For dates >85% occupancy with rate plans still open below
     threshold:
       Close the discounted rate plans
       Maintain the best-available-rate (BAR) for remaining sales
  3. For dates <40% occupancy 14-30 days out:
       Open promotional rate plans (with guardrails — never below
       break-even configured per workspace)
  4. ALL rate changes log to a workspace audit trail; revenue manager
     can review history + override.
```

## Hospitality-specific tax + financial discipline

- **Lodging / occupancy taxes** vary by jurisdiction (state, county, city, tourism district) and often apply on TOP of sales tax. Cloudbeds tax engine handles the collection; AutoFlow's QBO sync must preserve the per-jurisdiction breakdown so the operator can remit correctly.
- **OTA payments are NET** — Expedia/Booking.com pay the property after deducting commission. The reservation's `total` includes the commission. Don't double-count revenue.
- **Airbnb's "remit on behalf"** model — Airbnb collects + remits some taxes (depending on jurisdiction). Don't double-remit; track which taxes Airbnb handles.
- **ADR + RevPAR** are the universal hospitality KPIs. ADR = average daily rate, RevPAR = revenue per available room. Both should be on the standard daily report.

## Idempotency

Cloudbeds supports idempotency-key on reservation + folio writes. Use it for routine-driven writes. For guest record upserts, dedupe by email + phone before creating.

## Webhooks

Cloudbeds publishes webhooks for major events:
- `reservation.created`, `reservation.modified`, `reservation.canceled`
- `reservation.checked_in`, `reservation.checked_out`
- `payment.received`
- `guest.created`

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

## Rate limits

Cloudbeds publishes per-account rate limits in their developer portal — typically conservative for periodic sync. 429 with `Retry-After`. Daily snapshots / heavy reports should run during low-occupancy hours.

## What this skill does NOT cover

- **Hotel-grade enterprise PMS** (Opera, Maestro, OnQ) — different scale, different APIs.
- **Vacation-rental-only operators** (Airbnb-only short-term rentals) — better served by Guesty / Hostfully.
- **GDS connectivity** (Sabre, Amadeus for corporate travel) — managed in Cloudbeds's channel manager; AutoFlow doesn't touch GDS directly.
- **PCI scope** — credit-card tokens flow through Cloudbeds's payment processor; AutoFlow doesn't see raw PANs.
- **Housekeeping management** — Cloudbeds has it natively; AutoFlow agents don't usually reach for it.

## References

- API: https://hotels.cloudbeds.com/api/docs/
- OAuth: https://hotels.cloudbeds.com/api/docs/#section/Authentication
- Webhooks: https://hotels.cloudbeds.com/api/docs/#tag/Webhooks
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-property credentials; tax-jurisdiction breakdown preserved in QBO; OTA-payout reconciliation flow with email-ingest fallback)
