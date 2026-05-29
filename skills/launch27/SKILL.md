---
name: launch27
description: Use this skill when an AutoFlow agent needs to read or write data in Launch27 — the booking + scheduling platform for residential cleaning services, maid services, commercial cleaning, carpet cleaning, window washing, and other recurring service operators. Pull customers / bookings / cleaners / sales, react to booking events, push revenue to QuickBooks, run pre-clean reminder cadences, automate review requests, manage cleaner schedules + payouts, and run recurring-customer retention routines. Covers Launch27's REST API + auth, the Customer / Booking / Cleaner / Service / Frequency / Sale model, cleaning-business-specific considerations (key/code management, special instructions, liability for inside-home work), and the workflow shape AutoFlow customers reach for (one-time + recurring booking management, cleaner dispatch, customer reminder cadence, recurring conversion).
---

# Launch27 — recurring + one-time cleaning services management

Launch27 is a leading booking + scheduling platform for AutoFlow's cleaning-services SMBs — residential cleaning / maid services, commercial cleaning, carpet cleaning, window washing, post-construction cleaning, move-in/move-out cleaning, office cleaning, deep-cleaning specialists. Used by cleaning operators ranging from solo founders with a small team up to multi-truck mid-market cleaners.

Use Launch27 when the customer runs a **recurring cleaning service business** anchored on online booking + scheduled visits. For full-spectrum home services (HVAC, plumbing, etc.) → Jobber / Housecall Pro. For broader appointment-based services → other tools.

## When to reach for this skill

- **Online booking received** → confirmation routine, cleaner assignment, customer intake.
- **Pre-clean reminder cadence** — 24h-before and same-day reminders.
- **Cleaner dispatch + assignment** — match cleaner skill + location + availability to incoming bookings.
- **Post-clean** → review request routine, recurring-customer offer for one-time bookings.
- **Recurring booking management** — weekly/biweekly/monthly cadences, easy reschedule/cancel.
- **Cleaner payroll / payout** — per-clean commission tracking.
- **Customer retention** — recurring-customer churn signals + reactivation outreach.
- **Same-day rescheduling** — common operational pain; cleaner sick + need to shift bookings.

## Authentication

Launch27 uses **API key authentication** for partner integrations:

```
Authorization: Bearer <launch27-api-key>
```

Keys are issued in the operator's account settings. AutoFlow stores per-account credentials in secrets store.

Base URL: `https://api.launch27.com/v1/` (verify with current docs at integration time)

Multi-location operators typically have one Launch27 account per business; multi-market operators may have separate accounts per market.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Customer | The homeowner/business client | Primary contact + recurring cadence preferences |
| Address | A service location | Includes access notes (key codes, parking, pet info) |
| Booking | A scheduled cleaning visit | One-time or part of a recurring series |
| Service | The service type (Standard, Deep, Move-Out, Office, etc.) | Pricing + duration template |
| Frequency | One-time, weekly, biweekly, monthly | Recurring pattern |
| Cleaner | A team member who performs cleanings | Has skills, schedule, performance metrics |
| Crew | A group of cleaners working together | Larger jobs need multiple |
| Sale | A transaction | Source for billing |
| Payment | Money received | Card, cash, ACH |
| Extra | An add-on service (inside oven, fridge, laundry) | Variable line items |
| Discount / Promo | Promotional pricing | Code-based or manual |
| Tip | Customer tip for cleaner | Typically 100% pass-through |
| Recurring Subscription | Long-term commitment for a customer | Tracked separately from individual bookings |

## Common AutoFlow workflows

### 1. Online booking → confirmation + intake

```
Webhook on booking.created → Routine fires →
  1. Confirm via SMS to customer:
       "Confirmed: {service} on {date} at {time}. Total: ${amount}.
        Reply CANCEL to cancel or call us at {phone}."
  2. Auto-assign cleaner based on:
       - Cleaner availability + location proximity
       - Cleaner skills (deep-clean, pet-friendly, allergy-aware)
       - Customer history (repeat → preferred cleaner if available)
  3. Capture access details if missing:
       SMS: "How will we access your home? Reply with garage code,
              key location, or 'meet me' if you'll be home."
       Store on the address record.
  4. Notify the assigned cleaner via SMS:
       "New booking: {customer.first} at {address}. {date} at {time}.
        {service} ${duration}. Access: {access_note}."
```

### 2. Pre-clean reminder cadence

```
Cron routine daily →
  1. Identify bookings 24h out:
       Customer SMS: "Reminder: cleaning tomorrow at {time}.
                      Your cleaner: {cleaner.first}. Anything we
                      should know? Reply with any updates."
  2. 1 hour before:
       Customer SMS: "Your cleaner is on the way! ETA: {window}."
       Cleaner SMS: "Heading to {customer.first} now. Address: {addr}.
                     Access: {access_note}."
  3. Day-of changes (reschedule, late, sick cleaner): see workflow 6.
```

### 3. Post-clean → review + recurring conversion

```
Webhook on booking.completed → Routine fires →
  1. Send the customer payment confirmation + tip-suggestion SMS:
       "Your cleaning is done! Total: ${amount}. Tip {cleaner.first}
        for great service? {tip-link}"
  2. Cron 4 hours later: review request
       SMS: "How was your cleaning with {cleaner.first}? Leave a
              quick review: {google-review-link}"
  3. If one-time booking AND review ≥4 stars:
       Cron 3 days later: recurring offer
       SMS: "Loved your cleaning? Save 15% with weekly or biweekly
              recurring service: {recurring-link}"
  4. Recurring-conversion rate from one-time → recurring is the
     biggest revenue lever for cleaning businesses (industry
     benchmark ~30%); the offer cadence matters.
```

### 4. Recurring customer retention

```
Cron routine weekly →
  1. Identify recurring customers with patterns:
       - Skipped 2+ cleanings in last 8 weeks (potential drift)
       - Reduced frequency (weekly → biweekly, biweekly → monthly)
       - Canceled in last 7 days
  2. For drift signals:
       SMS: "Everything okay? Haven't seen you on the schedule lately.
             Let us know if you'd like to adjust your routine."
       Route to manager for personal follow-up (often life-event-
       related; care + flex > automation).
  3. For canceled:
       Light farewell + door-open follow-up
       30/60d later: comeback offer.
  4. Track recurring-customer churn rate; healthy is <5% monthly.
```

### 5. Cleaner dispatch + assignment

```
Continuous routine during booking + same-day-shift hours →
  1. For each unassigned booking, score available cleaners:
       - Distance from cleaner's previous booking (route efficiency)
       - Cleaner's reliability score (no-show rate, late rate)
       - Customer-cleaner history (preference if positive review)
       - Cleaner's daily capacity remaining
  2. Auto-assign or surface ranked candidates per workspace policy
  3. Notify cleaner + customer of the assignment.
```

### 6. Same-day reschedule (cleaner unavailable)

```
Triggered when a cleaner reports sick / unavailable same-day →
  1. Pull their day's bookings (already assigned)
  2. For each, attempt re-assignment:
       Find another available cleaner with compatible skills + capacity
       If found: reassign + notify both old + new cleaner + customer
       If not found within 30 minutes: surface to manager for customer
                                       outreach (offer reschedule with
                                       discount or apology credit)
  3. Same-day rescheduling is one of the most operationally painful
     events for cleaning businesses; routine + clear customer comm
     preserves trust.
```

### 7. Cleaner payroll / payout

```
Cron routine end-of-pay-period →
  1. Aggregate per-cleaner: bookings completed × commission rate
     + tips received (typically 100% pass-through)
     + bonuses (quality, reliability, longevity)
  2. Generate the cleaner pay statement
  3. Push to Gusto/ADP/QuickBooks Payroll (see gusto skill)
  4. Email each cleaner their statement for transparency.
```

## Cleaning-business-specific considerations

- **Key + access management** — cleaners often need keys, codes, or building access. Security-sensitive: never broadcast access details outside the assigned cleaner; revoke access immediately when a cleaner leaves.
- **Pets in home** — customers should disclose pets + behavioral notes; surface to cleaner before arrival (especially aggressive or anxious dogs — cleaner safety + pet safety).
- **Damage / loss liability** — if something breaks during a cleaning, the business carries liability insurance. Incidents must be documented promptly + reported to insurance per policy.
- **Background checks** — most cleaning businesses run background checks on cleaners working in homes; track expirations.
- **Workers comp + IC classification** — many cleaning businesses use independent contractors; misclassification has wage-and-hour exposure. Not an AutoFlow workflow but flagged for the business owner's awareness.
- **Tipping equity** — cleaners overwhelmingly depend on tips; ensure routines surface tip prompts effectively (industry benchmark ~50%+ tip rate on residential).

## Idempotency

Launch27's API supports idempotency on booking + payment writes. For routine-driven writes, use deterministic keys.

For customer + address upserts, dedupe by email + phone + address.

## Webhooks

Launch27 publishes webhooks for major events:
- `booking.created`, `booking.canceled`, `booking.rescheduled`, `booking.completed`
- `customer.created`, `customer.updated`
- `payment.completed`, `payment.failed`
- `recurring.created`, `recurring.canceled`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Launch27 publishes per-account rate limits in their developer portal. Typically conservative; 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Inventory management** (cleaning supplies, paper goods) — separate spreadsheet or inventory tool.
- **Marketing automation beyond review/win-back** — route through Mailchimp/Klaviyo.
- **Janitorial/commercial RFP management** — separate sales process.
- **Specialty service certifications** (IICRC for carpet cleaning, etc.) — track expirations as compliance.

## References

- API: https://www.launch27.com/api (per partner agreement)
- IICRC (cleaning industry standards body): https://www.iicrc.org/
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-account credentials; access-detail security discipline on cleaner notifications)
