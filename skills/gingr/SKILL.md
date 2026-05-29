---
name: gingr
description: Use this skill when an AutoFlow agent needs to read or write data in Gingr — the practice-management platform for pet boarding, doggy daycare, grooming, dog training, and dog walking businesses. Pull pets / owners / reservations / boarding / daycare passes / sales, react to booking events, push revenue to QuickBooks, manage vaccine compliance, run capacity + waitlist routines, automate confirmation + reminder cadences. Covers Gingr's REST API + auth, the Owner / Pet / Reservation / Service / Pass / Package model, pet-business-specific compliance considerations (vaccine + temperament requirements, liability waivers, emergency contact protocols), and the workflow shape AutoFlow customers reach for (reservation confirmation + reminder, vaccine compliance check, daily report card automation, package depletion).
---

# Gingr — pet boarding, daycare, grooming, training management

Gingr is the leading practice-management platform for AutoFlow's pet-services SMBs — dog boarding facilities, doggy daycares, mobile grooming + brick-and-mortar grooming salons, dog training schools, dog walking services, pet hotels, kennels. Distinct from clinical veterinary platforms (ezyVet/Cornerstone) because Gingr focuses on **non-medical pet services**: lodging, daycare, grooming, training, walking — recreational + care services, not medical treatment.

Use Gingr when the customer is a **non-clinical pet-services business**. For veterinary clinics → ezyVet. For pet retail → Square POS + adjacent tools.

## When to reach for this skill

- **Reservation booked** → confirmation + pre-arrival prep routine, vaccine compliance check.
- **Pre-arrival vaccine verification** — pets must have current vaccines (DHPP, Rabies, Bordetella for boarding/daycare; varies by service).
- **Check-in / check-out** → daily care report card, owner update messages with photos.
- **Daycare pass / package depletion** → renewal outreach.
- **Capacity management** — boarding/daycare have hard capacity limits; daily occupancy + waitlist routines.
- **Recurring weekly daycare** — many regular customers come 2-5x per week; subscription/package management.
- **Holiday peak booking** — Thanksgiving/Christmas/Spring Break are 3-5x normal demand; advance-booking cadence is critical.
- **Grooming appointment reminders** — typical 4-8 week recurrence.

## Authentication

Gingr uses **API key authentication** via partner integration:

```
X-Gingr-API-Key: <gingr-api-key>
```

Keys are issued in the facility's admin settings. AutoFlow stores in secrets store; per-facility credentials.

Base URL: `https://{facility-subdomain}.gingrapp.com/api/v1/`

Multi-facility operators (pet-care chains) have a separate subdomain + API key per location.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Owner | The pet's human (the customer) | Source of payment + communications |
| Pet | The dog, cat, or other animal | Linked to owner; can have multiple owners (joint custody, split households) |
| Reservation | A booking for a service | Boarding, daycare, grooming, training |
| Service | The service type | "Standard Boarding", "Daycare Half-Day", "Bath + Brush" |
| Room / Suite / Run | Physical lodging space | For boarding; capacity tracking |
| Daycare Pass | Pre-paid daycare credit pack | "10-day pass" |
| Package | Bundled services | "Boarding + Bath" |
| Membership | Recurring access (premium daycare) | Some facilities offer |
| Sale | A transaction | Source for billing |
| Payment | Money received | Card, ACH, cash |
| Vaccine Record | Vet-issued vaccine documentation | Required for boarding/daycare access |
| Behavior Note | Pet's temperament + special handling | Critical for staff safety |
| Emergency Contact | Backup human for emergencies | Critical when owner is traveling |
| Vet | The pet's veterinarian | For emergency contact + records |
| Feeding / Medication Schedule | Per-pet care instructions | During boarding |

## Common AutoFlow workflows

### 1. Reservation confirmation + vaccine compliance check

```
Webhook on reservation.created → Routine fires →
  1. Send confirmation SMS to owner:
       "Booked! {pet.name} is set for {service} on {date}.
        We'll need current vaccine records before {arrival_date}."
  2. Check vaccine status: are DHPP, Rabies, Bordetella all current
     and not expiring before reservation end?
  3. If missing or expiring:
       SMS: "Heads up — {pet.name}'s {vaccine_name} expires before
              your stay. Please send updated records from your vet."
       Schedule cron 7d before reservation: re-check + escalate
       Cron 3d before: hard reminder — without records, can't accept
                       pet (safety + state-law requirement)
       1d before: owner phone call if still missing
  4. Track vaccine-compliance status; surface to front-desk for any
     pet checking in without current records.
```

### 2. Pre-arrival prep routine (boarding specifically)

```
Cron routine 3 days before reservation arrival →
  1. SMS owner:
       "Looking forward to seeing {pet.name} in 3 days!
        Reminders:
        - Bring vaccine records if not already on file
        - Pack {pet.name}'s food (we can provide for fee)
        - Bring any medications with instructions
        - Drop-off times: {hours}
        Reply with any questions."
  2. Cron 1 day before:
       SMS: "See you tomorrow! Arrival window: {time}."
  3. Special-handling pets (medications, anxiety, dietary restrictions)
     trigger additional staff prep notifications.
```

### 3. Daily report card automation (daycare/boarding)

```
End-of-day routine →
  1. For each pet in care today, generate a "report card":
       Activities they enjoyed (play, walks, naps)
       Friends they played with (other pet names — opt-in for privacy)
       Meals eaten + treats given
       Bathroom breaks
       Photos taken
  2. SMS/email the report card to the owner with embedded photo
  3. For owners traveling on long boarding stays: scheduled
     "midstay update" routine (typically every 2-3 days)
  4. Detected concerns (not eating, behavioral change, injury):
       Escalate to manager FIRST; manager calls owner directly
       (NEVER auto-message owner about a concern — staff context
        + judgment matters).
```

### 4. Daycare pass depletion → renewal

```
Cron routine daily →
  1. Query owners with daycare passes where remaining_days <= 2 AND
     average usage > 1 day/week (active users likely to renew)
  2. SMS the owner:
       "Hi {owner.first}! {pet.name} has 2 days left on the current
        package. Reply RENEW to keep the fun going or call us at {phone}."
  3. On RENEW: process the pass purchase routine
  4. For high-LTV regulars (2+ years, 100+ days): personal outreach
     from facility manager (relational > automated).
```

### 5. Holiday peak booking cadence

```
Cron routine 60 days before Thanksgiving / Christmas / Spring Break →
  1. Identify owners who boarded last year during the same holiday
     window
  2. Email + SMS them with priority booking offer:
       "Our holiday spots fill up fast — book {pet.name}'s {holiday}
        stay before {early-bird deadline}. Reserve: {link}"
  3. Cron 30 days before holiday: open booking to general audience;
     SMS regulars who haven't booked yet
  4. Cron 14d before: waitlist routine if at capacity
  5. Holiday utilization can be 95-100%; missing peak revenue is
     painful.
```

### 6. Grooming recurring appointment reminders

```
Cron routine daily →
  1. Query grooming appointments completed where pet has a
     typical-recurrence-interval (e.g. 6 weeks for poodles)
  2. At interval - 2 weeks: SMS owner:
       "Hi {owner.first}, {pet.name} is due for a groom in 2 weeks.
        Book: {link} or call us at {phone}."
  3. Track grooming retention rate — typical 60-70% return rate.
```

### 7. Capacity + waitlist management

```
Continuous routine during booking +near-arrival windows →
  1. Check current + scheduled occupancy per room type
  2. If at capacity for requested dates:
       Add the inquiry to waitlist
       Notify owner: "We're full but you're on the waitlist; we'll
                       let you know if a spot opens"
  3. On cancellation: auto-promote first waitlister
       SMS: "Good news! A spot just opened for {pet.name} on {date}.
              Reply YES within 4 hours to confirm."
  4. Capacity routines run continuously during peak season; help
     avoid both over-booking and under-utilization.
```

## Pet-business compliance considerations

- **Liability waivers** — every owner should sign a boarding/daycare waiver before first stay. Surface waiver-missing status; don't accept new owners without one.
- **State licensing** — some states license boarding/grooming facilities; inspections + protocol compliance varies. Don't help skirt state inspections.
- **Vaccine + health requirements** — required for the safety of all pets in care; never bypass without facility-policy approval.
- **Temperament screening / evaluations** — many facilities require a "meet & greet" temperament evaluation before allowing a new dog into group daycare. Track + enforce.
- **Bite reporting** — bite incidents typically must be reported to local animal control + the bitten party's owner. Critical for liability + public safety.
- **Emergency vet protocols** — if a pet needs emergency vet care during a stay, the facility must have explicit authorization in the boarding contract. Always confirm at booking, surface to staff.
- **Photo + social media consent** — owner consent for sharing photos publicly; respect on a per-owner basis.

## Idempotency

Gingr's API has uneven idempotency support. For routine-driven writes:
- Reservations: dedupe by (owner_id, pet_id, service, datetime)
- Owner/Pet upserts: query by email + pet name before creating
- Charges: store correlation IDs to detect double-charges

## Webhooks

Gingr supports webhooks for some events; coverage varies by version. Common topics:
- `reservation.created`, `reservation.canceled`
- `check_in.completed`, `check_out.completed`
- `sale.completed`
- `pet.created`

Signature verification varies; verify according to facility's webhook config.

For events not pushed, fall back to incremental polling.

## Rate limits

Gingr publishes per-facility rate limits — typically conservative for periodic syncs. 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Clinical veterinary care** — Gingr is for non-medical services; veterinary integration → ezyVet.
- **Pet retail / e-commerce** — separate from boarding/grooming operations.
- **Training curriculum + content** — Gingr tracks the scheduling + billing; what's taught is the trainer's domain.
- **Mobile dog walker GPS tracking** — separate apps (Time to Pet, PetCheck).
- **Pet adoption / rescue management** — different tools (Animals.io, Petstablished).

## References

- API: https://gingrapp.com/api-documentation (per-facility access)
- AVMA pet care safety: https://www.avma.org/resources-tools/pet-owners
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-facility subdomain credentials; vaccine-compliance gate on check-in routines; waiver-status gate on first-stay routines)
