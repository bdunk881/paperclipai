---
name: glofox
description: Use this skill when an AutoFlow agent needs to read or write data in Glofox — the boutique-fitness-studio management platform for small group-class gyms, yoga studios, pilates studios, CrossFit boxes, boutique cycling/HIIT studios, martial arts academies, and small specialty fitness operators. Pull members / classes / bookings / packages / sales, react to booking and check-in events, push revenue to QuickBooks, run no-show / late-cancel routines, manage member churn, automate trial-to-member conversion. Covers Glofox's REST API + OAuth, the Member / Class / Booking / Package / Membership / Lead model, fitness-business-specific considerations (waiver requirements, injury liability, capacity management), and the workflow shape AutoFlow customers reach for (lead → trial → conversion, class booking + check-in, membership churn prevention).
---

# Glofox — boutique fitness + group-class studio management

Glofox (owned by ABC Fitness Solutions) is a leading practice-management platform for AutoFlow's boutique-fitness SMBs — small group-class gyms, yoga studios, pilates studios, barre studios, CrossFit boxes, boutique cycling/HIIT studios, martial arts academies, small functional fitness operators. Used by ~5,000+ studios globally.

Use Glofox when the customer is a **boutique fitness studio focused on group classes + memberships**. For broader wellness platforms (massage, spa, hair) → Mindbody or Boulevard. For 1-on-1 personal training only → smaller booking tools (Acuity, Calendly). For big-box gyms → ABC Fitness Solutions enterprise products.

## When to reach for this skill

- **Lead → trial → conversion** — prospect signs up for a trial class, drive to membership purchase within trial period.
- **Class booking + check-in** — member books, gets reminders, checks in via app or front desk.
- **No-show / late-cancel** — fee per studio policy or class-credit forfeit.
- **Membership churn prevention** — usage drop signals churn risk; reactivation outreach.
- **Member milestone celebration** — 100th class, 1-year anniversary, etc. → personal touch.
- **Waitlist auto-promote** — class spots opening up auto-fill from waitlist.
- **Daily class capacity** — ensure popular classes don't book over capacity (Glofox enforces but AutoFlow can predict + add second classes when demand justifies).
- **Sales/finance close** — daily reconciliation.

## Authentication

Glofox uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <glofox-access-token>
X-Branch-Id: <branch-id>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

Branch-scoped: every API call is scoped to a single branch (studio location). Multi-location chains have multiple branch IDs under one org grant. AutoFlow connection records pin per-branch.

Base URL: `https://api.glofox.com/admin/api/` (verify current path with current docs at integration time — Glofox unified some endpoints under ABC Fitness's domain post-acquisition)

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Branch | A studio location | Top-level scope |
| Member | The customer | One per person; can be active/lapsed/trial |
| Lead | A prospect not yet a member | Pre-conversion |
| Class | A group class instance | Scheduled time + capacity + instructor |
| Class Type | A class template (e.g. "Beginner Pilates") | Reusable schedule pattern |
| Instructor | Studio staff who teaches | Schedule + qualifications |
| Booking | A member's reservation for a class | Becomes attendance on check-in |
| Waitlist Entry | Pending booking when class is full | Auto-promoted on cancellations |
| Package | Pre-paid class credit bundle ("10-class pack") | One-time purchase |
| Membership | Recurring subscription | Monthly/annual; unlimited or limited classes |
| Trial | A short-term limited-access pass | Drives conversion routine |
| Sale | A transaction (membership, package, retail) | Source for billing + revenue |
| Payment | Money received | Card, bank, in-person |
| Branding Settings | Studio brand for customer-facing communications | Used in templated emails/SMS |

## Common AutoFlow workflows

### 1. Lead → trial → conversion routine

```
Webhook on lead.created OR trial.started → Routine fires →
  1. Send a welcome SMS via Twilio:
       "Welcome to {studio}, {first_name}! Here's how to book your first
        class: {link}"
  2. Day 1 after first class:
       SMS: "How was your first class? We can't wait to see you back!
             Book another: {link}"
  3. Day 3 of trial (if trial period typical 7-14 days):
       Email + SMS: "Loving the workouts? Convert your trial — first
                     month 50% off if you sign up now."
       Surface to front-desk for personal conversation if member
       checked in 2+ times
  4. Day 1 BEFORE trial expires:
       SMS: "Trial ends tomorrow — convert to membership: {link}"
  5. Day 1 AFTER trial expires without conversion:
       Lapsed-trial sequence (light touch over 30d, then archive)
  6. Track trial → membership conversion rate (industry benchmark
     ~30-40% for boutique fitness).
```

### 2. Class booking confirmations + reminders

```
Webhook on booking.created → Routine fires →
  1. Booking confirmation SMS via Twilio (Glofox sends natively;
     AutoFlow can augment with brand voice):
       "Booked! {class.name} with {instructor.first} on {date} at {time}.
        Reply CANCEL to free up your spot for someone else."
  2. Cron 24h before: reminder SMS
  3. Cron 1h before: prep reminder (bring water, grippy socks, etc.)
  4. On CANCEL reply: cancel the booking + open waitlist promotion
                     routine if applicable.
```

### 3. No-show / late-cancel fee

```
Webhook on booking.no_show OR booking.canceled_late → Routine fires →
  1. Check member's plan + studio policy:
       Unlimited membership: typically a charge ($10-15 late-cancel fee)
       Class pack: forfeit the class credit
       Trial: warning + escalation if repeated
  2. Apply the policy:
       Charge via card-on-file (Stripe under the hood)
       OR deduct class credit
  3. SMS the member: "Per our policy, we've applied a late-cancel fee/
                       deducted a class credit. Reply HELP for questions."
  4. Three late-cancels in 30 days → warn member + tag for staff review
     (boutique studios often have policy escalation; informed member
     decision).
```

### 4. Membership churn prediction + reactivation

```
Cron routine weekly →
  1. Compute usage trend per active member:
       attendance_last_30d vs attendance_30_60_days_ago
       attendance_last_30d vs member's lifetime average
  2. Members with attendance dropped >40% AND zero classes in last 14d:
       Tag as "churn-risk"
       Surface to front-desk for personal outreach (the dropping member
       is often dealing with something — pregnancy, injury, schedule
       change, life event; staff conversation > automated email)
  3. Members with zero attendance in 30 days + still paying:
       Send a thoughtful "we miss you" email
       Offer pause-membership option (often retains the relationship)
  4. Members canceled in last 7 days:
       Light farewell + door-open follow-up email
       60d later: comeback offer if appropriate
  5. Track churn rate + reactivation rate by cohort.
```

### 5. Waitlist auto-promote

```
Webhook on booking.canceled (where class has waitlist) → Routine fires →
  1. Pull the class waitlist in order (first-in usually)
  2. Take the first eligible member (still active membership + class
     was on their watch list):
       Auto-create the booking
       SMS them: "🎉 A spot opened in {class.name} at {time}. You're in!"
  3. If they want to cancel (replied CANCEL):
       Free the spot + try the next waitlister
```

### 6. Member milestones

```
Cron routine daily →
  1. For each member, compute milestones:
       Total classes attended
       Days since first class
       Anniversary (member-since)
  2. At 50/100/200/500/1000 classes: SMS celebration + small reward
     (free smoothie, free class pass for a friend, branded swag)
  3. At 1-year and 5-year anniversaries: personalized message from
     studio owner (route to owner for personal sending)
  4. Public celebration on the leaderboard (with member opt-in).
```

### 7. Daily reconciliation

```
Cron routine at 11pm studio-local →
  1. Aggregate the day's sales:
       Memberships sold (new + recurring renewals)
       Packages sold (class packs, drop-ins)
       Retail (apparel, accessories)
       Late-cancel fees, no-show fees
       Refunds, discounts
  2. POST QBO entries:
       Debit Bank/AR
       Credit Membership Revenue
       Credit Package Revenue (with deferred-revenue accounting for
                                un-consumed classes)
       Credit Retail Revenue
       Credit Fees (separate line for membership health analysis)
  3. Slack/email daily report to studio owner with KPIs:
       new members today, churned today, total active, attendance %,
       trial conversions.
```

## Fitness-business compliance considerations

- **Liability waivers** — every member should sign a liability waiver before first class. AutoFlow routines must surface waiver-missing status; don't auto-book a class for a member without one.
- **Injury / incident reporting** — when a member gets hurt in class, the studio's incident report is the primary record. AutoFlow doesn't drive these — staff documents.
- **Medical pre-existing condition disclosure** — typical at intake; for studios serving older or rehab-focused populations, sensitive data flows here. Treat with similar discipline as PHI even though not HIPAA-covered.
- **Membership cancellation rules** — state-specific consumer-protection rules govern membership cancellation (notice periods, refund rules). Glofox handles via UI; AutoFlow surfaces deadlines.

## Idempotency

Glofox supports idempotency on booking + sale endpoints. For routine-driven writes, use deterministic keys.

For member upserts, dedupe by email or phone before creating.

## Webhooks

Glofox publishes webhooks for major events:
- `member.created`, `member.updated`
- `lead.created`, `lead.converted`
- `booking.created`, `booking.canceled`, `booking.no_show`
- `sale.completed`, `membership.created`, `membership.canceled`
- `class.created`

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

## Rate limits

Glofox publishes per-account rate limits — typically conservative. 429 with `Retry-After`. Heavy reports (member health, churn analysis) off-peak.

## What this skill does NOT cover

- **Mindbody scheduling** — separate platform; if a customer is on both, dedupe carefully.
- **Branded mobile app customization** — Glofox provides; AutoFlow doesn't drive.
- **In-class technology** (heart-rate tracking, performance leaderboards) — separate hardware/software (MyZone, Polar, etc.).
- **Personal training scheduling** — Glofox has it but most boutique-fitness customers use a dedicated PT booking tool.
- **Nutrition + meal plans** — separate tools (Truwill, Trainerize).

## References

- API: https://docs.glofox.com/ (partner access)
- ABC Fitness Solutions (post-acquisition parent): https://www.abcfitness.com/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-branch credentials; waiver-status gate on first-class-booking routines)
