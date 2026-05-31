---
name: fareharbor
description: Use this skill when an AutoFlow agent needs to read or write data in FareHarbor — the reservation + ticketing + operations platform for tour operators, activity providers, experience businesses, attractions, and adventure outfitters (zip-line tours, kayak rentals, food tours, escape rooms, axe throwing, breweries with tours, museums, distillery tours, helicopter tours, fishing charters, ATV tours, indoor karting, climbing gyms with experiences). Pull bookings / availability / guests / items / capacity, react to booking and weather events, push revenue to QuickBooks, manage capacity + manifests, run pre-arrival guest cadences, automate review requests, and reconcile OTA channel payouts. Covers FareHarbor's API + auth, the Item / Booking / Availability / Customer / Manifest / Channel model, tour-operator-specific considerations (capacity management, weather cancellations, waiver requirements, safety briefings), and the workflow shape AutoFlow customers reach for (booking confirmation, pre-experience prep, manifest finalization, post-experience review + referral, weather cancel routine).
---

# FareHarbor — tour, activity, attraction reservation management

FareHarbor (a Booking Holdings company) is the leading reservation + ticketing platform for AutoFlow's tour + activity + experience SMBs — zip-line + canopy tours, kayak/canoe/paddleboard rentals + tours, food tours, escape rooms, axe throwing venues, brewery tours, museum + cultural attractions, distillery tours, helicopter/charter flights, fishing charters, ATV/UTV tours, indoor karting, climbing gyms with experience programs, ghost tours, walking tours, sailing charters. Used by 10,000+ tour operators globally.

Use FareHarbor when the customer operates **scheduled tours/activities/experiences with capacity limits**. For appointment-based services → various (Calendly, Mindbody). For straight rentals without guided experience → simpler rental tools.

## When to reach for this skill

- **Booking received** → confirmation + pre-arrival routine + safety waiver collection.
- **Pre-experience prep** — what to wear, what to bring, arrival logistics.
- **Manifest finalization** — day-of guide gets the manifest with guest details + special accommodations.
- **Weather cancellation** — rapid decision + guest comms + reschedule offers.
- **Post-experience** → review request, photo/video sales, referral ask.
- **Channel sync** — FareHarbor distributes to GetYourGuide, Viator, Expedia, Klook, etc.; payouts need reconciliation.
- **Capacity management** — popular tours sell out; waitlist + additional-departure routines.
- **Group / private bookings** — corporate events, school groups, weddings; different pricing + workflow.

## Authentication

FareHarbor offers API access through partner program:

```
X-FareHarbor-API-App: <fareharbor-app-key>
X-FareHarbor-API-User: <fareharbor-user-key>
```

Two-key authentication: an app-level key + a per-account user key. AutoFlow stores both in secrets store.

Base URL: `https://fareharbor.com/api/external/v1/companies/{shortname}/` (per company shortname; capture at install)

Multi-location operators: typically one FareHarbor account per location; AutoFlow connections pin per-company-shortname.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Company | The tour operator | Top-level scope (per shortname) |
| Item | A bookable experience (e.g. "Sunset Kayak Tour") | Template definition |
| Availability | A specific scheduled slot of an Item | The actual bookable instance |
| Booking | A customer reservation against an Availability | Multiple customers per booking |
| Customer | A guest (booking lead) | Has contact info |
| Booking Custom Field | Custom data captured at booking (dietary, etc.) | Item-configurable |
| Manifest | Day-of guide's roster | Generated per Availability |
| Item Add-On | Extras (gear rental, photo package, etc.) | Optional uplifts |
| Pickup Location | For tours with pickup service | Logistics |
| Channel | Distribution source (FareHarbor Direct, GetYourGuide, Viator, etc.) | Per-channel commission |
| Booking Note | Special accommodations, allergies, mobility | Guide-visible |
| Cancellation | A canceled booking | Refund vs no-refund per policy |
| Discount Code | Promotional codes | Marketing source |
| Gift Card | Stored-value gift certificate | Common in experience businesses |

## Common AutoFlow workflows

### 1. Booking received → confirmation + pre-arrival cadence

```
Webhook on booking.created → Routine fires →
  1. Send booking confirmation email immediately:
       Receipt, tour details, meeting point, what to bring, arrival
       time (typically 15-30 min early for check-in + waiver)
       Waiver link if not signed at booking
  2. If waiver not signed: cron 24h reminder via SMS
       "Please sign your waiver before arrival: {link}.
        This helps check-in go quickly!"
  3. Day before:
       SMS: "Your {tour_name} is tomorrow at {time}! Meeting point:
              {address}. Bring: {list}. Wear: {recommendation}.
              Questions? Reply or call {phone}."
  4. Day of:
       3 hours before: SMS reminder + weather/traffic update if
       relevant (e.g. "expecting clear skies — perfect for paddling")
       1 hour before: ETA confirmation request from guest
```

### 2. Manifest finalization for the guide

```
Cron routine 3 hours before each scheduled Availability →
  1. Pull the manifest: all customers booked on this Availability
  2. Pull any custom-field data: dietary restrictions, mobility notes,
     ages of children, special requests, anniversaries / birthdays
  3. Pull waiver status per customer
  4. Generate the guide's manifest sheet (printable or app-display):
       - Booking name, party size, ages
       - Waiver: signed/unsigned (flag unsigned for in-person sign)
       - Special accommodations: highlighted
       - Add-ons purchased (gear sizes, etc.)
       - Pickup logistics if applicable
       - Any special-occasion celebrations
  5. SMS/Slack the guide a heads-up:
       "Tomorrow's 9am Kayak Tour: 8 guests, 1 family with
        birthday + 1 mobility note. Manifest ready."
  6. Day-of-experience preparedness is the single biggest factor in
     review scores.
```

### 3. Weather cancellation routine

```
Triggered when operator decides to cancel for weather/safety →
Routine fires →
  1. Cancel the Availability in FareHarbor
  2. For each booked customer:
       SMS + email immediately:
         "Unfortunately, today's {tour_name} is canceled due to
          {weather_reason}. Your options:
          1. Reschedule (we'll help find a slot): {link}
          2. Full refund: {link}
          3. Gift card for full amount + 10% bonus: {link}
          Reply with your choice or call {phone}."
       Trigger refund processing if choice is refund (and remove
       further reminder messaging)
  3. Aggregate stats for the day to operations dashboard
     (revenue impact, rebooking conversion rate).
  4. Weather cancels are emotional + operationally painful; clear
     comms + multiple options preserve customer relationship.
```

### 4. Post-experience review + referral cadence

```
Cron routine 4 hours after Availability end-time →
  1. SMS guest:
       "Hope you loved {tour_name} with {guide.first}!
        Mind leaving us a review? It helps small businesses like ours
        thrive. Google: {link}  TripAdvisor: {link}  Yelp: {link}"
  2. Day after:
       Email follow-up with photos (if photo package or free photo
       sharing) + referral perk:
       "Loved your experience? Refer a friend and you both save 10%
        on your next experience: {referral_code}"
  3. Tag in workspace CRM by booking-source for marketing attribution
  4. Track review rate (industry benchmark: 5-15% leave reviews;
     well-timed prompts can lift to 25%+).
```

### 5. Channel sync + OTA payout reconciliation

```
Channels handled by FareHarbor distribution (auto-sync), plus monthly
payout reconciliation cron →
  1. Pull each connected channel's monthly statement (GetYourGuide,
     Viator, Expedia, etc.)
  2. Match each line item to a FareHarbor booking
  3. Compute expected: gross - channel_commission - tax_remitted_by_OTA
  4. If discrepancy > tolerance: surface to operator for dispute
  5. POST QBO entries:
       Debit Bank (payout)
       Debit Channel Commission expense (per channel)
       Credit Tour Revenue (per item type)
       Track tax remittance per OTA's handling.
```

### 6. Capacity management + waitlist

```
Continuous routine during peak booking + same-day check-in →
  1. For each Availability nearing capacity:
       Operator-configurable: at 80% full, consider adding additional
       departure if demand warrants (operator decision, not auto)
       At 100% full: enable waitlist on the booking flow
  2. On cancellation: auto-promote first waitlist entry
       SMS: "Good news! A spot opened for {tour_name} at {time}.
              Reply YES within 4 hours to confirm."
  3. Track capacity utilization rate per Item per day-of-week.
```

### 7. Group / private booking routine

```
Triggered by inquiry from group source (school, corporate, wedding) →
Routine fires →
  1. Capture group details: size, date preferences, special needs
  2. Match to private-event capacity (often operators have separate
     private-tour pricing + scheduling)
  3. Generate quote + contract:
       Group discount per policy
       Deposit terms (typically 50% to hold the date)
       Cancellation policy
  4. Send via DocuSign for signature
  5. On signed contract + deposit: schedule on operator's calendar +
     assign guide team
  6. Pre-event coordination cadence; post-event recap to organizer.
```

## Tour-operator-specific compliance

- **Waiver requirements** — most experience businesses use liability waivers; some states (e.g. California Civil Code §1812.50 for fitness, varies for other experiences) impose specific requirements on waivers. AutoFlow tracks waiver status; operator owns waiver content.
- **Safety briefings** — many experiences (zip-line, kayak, climbing) require documented pre-experience safety briefings; varies by state insurance + liability law.
- **Children / age policies** — many experiences have age minimums or require adult supervision; surface clearly at booking.
- **Alcohol-involved experiences** (brewery tours, wine tours, distillery experiences) — ID verification often required; some states regulate the operator's relationship with alcohol producers.
- **Watercraft experiences** — Coast Guard rules on safety equipment, boat capacity, captain licensing (USCG OUPV captain for paid passenger trips on certain vessels).
- **Permit requirements** — many experiences operate under government-issued permits (national parks, forests, wildlife refuges, marine sanctuaries) with specific reporting + insurance requirements.
- **Insurance** — typically high-limit commercial general liability ($1-5M) per industry; track COI status.

## Idempotency

FareHarbor's API supports idempotency on booking writes. For routine-driven creates, use deterministic keys.

For customer upserts, dedupe by email + phone before creating.

## Webhooks

FareHarbor publishes webhooks for major events:
- `booking.created`, `booking.canceled`, `booking.rebooked`
- `availability.canceled`
- `customer.created`
- `payment.completed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

FareHarbor publishes per-account rate limits. Typically conservative for periodic syncs; 429 with `Retry-After`. Heavy operations (full-year manifest pulls) off-peak.

## What this skill does NOT cover

- **Photo / video sales platforms** (PhotoPass-style) — separate vendors for in-experience photography.
- **Equipment rental + tracking** (gear inventory) — basic add-on rentals in FareHarbor; complex inventory tools (Booqable, Rentle) are separate.
- **Tour guide training / certification** — operator-managed.
- **OEM equipment certification** (zip lines, climbing structures) — third-party inspectors per industry standards.
- **Dynamic pricing engines** — most experience businesses use fixed pricing + manual promo; some layer separate tools.

## References

- API: https://fareharbor.com/help/api (partner program)
- USCG OUPV: https://www.uscg.mil/
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-company-shortname; waiver tracking + safety-briefing surfacing; weather-cancel rapid-comms routine)
