---
name: teachworks
description: Use this skill when an AutoFlow agent needs to read or write data in TeachWorks — the practice-management platform for independent tutoring businesses, music schools, learning centers, test-prep companies, and small academic enrichment operators. Pull students / teachers / lessons / families / invoices, react to lesson and attendance events, push billing to QuickBooks, manage parent communications, run lesson-package consumption tracking, automate make-up scheduling. Covers TeachWorks's REST API + API-key auth, the Student / Family / Teacher / Lesson / Service / Invoice / Package model, education-specific considerations (FERPA, minor consent, billing-parent vs student dual-record), and the workflow shape AutoFlow customers reach for (lesson reminder cadence, no-show/make-up handling, package depletion → renewal, parent communication).
---

# TeachWorks — independent tutoring + lesson business management

TeachWorks is a leading practice-management platform for AutoFlow's small-education SMBs — private tutoring businesses, music schools, language schools, learning centers, test-prep firms, swim/dance/martial-arts academies, academic enrichment operators. Used by independent tutors with handfuls of students up to multi-location franchises with 50+ teachers.

Use TeachWorks when the customer is a **lesson-based small education business** — students book or are booked into recurring lessons, billed by package/subscription/per-lesson, parent communication is core. For preschool / childcare → Brightwheel / Procare. For K-12 schools → big platforms (PowerSchool, etc.) outside SMB scope.

## When to reach for this skill

- **Lesson reminder cadence** — student/parent reminders 24h and 1h before lessons.
- **No-show / late-cancel** — fee per policy + automatic make-up offer.
- **Lesson package depletion** → renewal outreach when a student has 1-2 lessons left in their package.
- **Make-up scheduling** — student missed a lesson with valid cancellation, find a future available slot.
- **Parent communication** — progress updates, billing questions, schedule changes (often to a parent ≠ student record).
- **Recital / event RSVPs** — periodic events (recitals, parent observation weeks, group classes).
- **Teacher payroll prep** — lessons taught × per-lesson rate → payroll feed.
- **End-of-month billing** — generate invoices, send statements, run autopay.

## Authentication

TeachWorks uses **API key authentication**:

```
Authorization: Token token=<teachworks-api-key>
```

Keys are issued in the account's admin settings.

Base URL: `https://api.teachworks.com/v1/`

Multi-location franchise operators have one TeachWorks account per location in most setups; AutoFlow connection records pin per-location.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Student | The person taking lessons | Often a minor |
| Family | A billing group (parent + minor students) | Source of payment |
| Teacher | The instructor | Has subjects, schedule |
| Service | A lesson type (Piano - 30min, Math Tutoring - 1hr) | Pricing + duration |
| Lesson | A scheduled instance | Recurring or single |
| Calendar | The schedule view | Multi-teacher coordination |
| Package | Pre-paid lesson bundles | "10 lessons for $400" |
| Subscription | Recurring autopay billing | Monthly/weekly |
| Invoice | Billing record | Linked to family |
| Payment | Money received | Card, ACH, check, cash |
| Teacher Hour | Hours-taught record | Source for teacher payroll |
| Note / Progress Report | Notes on a student's progress | Privacy-sensitive |
| Communication | Logged email / SMS with family | Audit + reference |

## Regulatory considerations

- **FERPA** (Family Educational Rights and Privacy Act) applies to schools receiving federal funding — most independent tutoring businesses don't fall under FERPA, but if the customer serves school-affiliated students (district contracts, school partnerships), FERPA may bind them.
- **Minor consent / COPPA** — students under 13 require parental consent for data collection. AutoFlow routines that text/email students under 13 should default to **parent-only** communication.
- **Billing-parent vs student dual-record** — the parent is often the billing contact + decision-maker but lessons are scheduled around the student. Communications must be addressed correctly (lesson reminders to parent for under-13 students; to student + parent for teens; to student for adults).
- **Background-check disclosure** — instructors of minors typically require background checks per state law; AutoFlow can track expiration dates + remind for renewal.

## Common AutoFlow workflows

### 1. Lesson reminder cadence

```
Cron routine OR webhook on lesson.scheduled →
  1. At 24h before lesson:
       For students 13+: SMS the student (and parent CC if under 18)
       For students under 13: email/SMS the parent ONLY
       Message: "Reminder: {student.first} has piano with {teacher.first}
                 tomorrow at {time}. Reply C to confirm or R to reschedule."
  2. At 1h before:
       SMS the family: "Lesson in 1 hour. {teacher.first} will see you
                        then!"
  3. On C reply: cancel further reminders
  4. On R reply: open rescheduling routine — route to admin/teacher
                 for make-up coordination.
```

### 2. No-show + late-cancel handling

```
Webhook on lesson.no_show or lesson.canceled_late → Routine fires →
  1. Check the policy: was this within the cancellation window
     (e.g. >24h notice = no charge, <24h = charge)
  2. If chargeable:
       Apply lesson charge to the family invoice
       SMS the family: "Sorry we missed you for {student.first}'s lesson.
                        Per our policy, this lesson has been charged.
                        Reply HELP if you have questions."
       Mark the lesson as "no-show, charged"
  3. If within make-up policy:
       Offer make-up slot via SMS with 2-3 available times
       On reply: book the make-up.
```

### 3. Package depletion → renewal

```
Cron routine daily →
  1. Query students on a package where remaining_lessons <= 2 and
     no future package or subscription queued
  2. Send the family a friendly renewal SMS:
       "Hi {parent.first}, {student.first} has 2 lessons left in this
        package. Reply RENEW to continue or call us at {phone}."
  3. On RENEW reply: process the package purchase routine (apply payment
     method, create new package, link to next lessons)
  4. If no response by last lesson: surface to admin for personal
     follow-up — losing a student to lack of communication is
     preventable churn.
```

### 4. Make-up auto-scheduling

```
Triggered by workflow 2's make-up offer (or family-initiated request) →
Routine fires →
  1. Find the student's teacher's available slots in next 14 days
  2. Filter to slots that match the student's typical lesson day-time
     preferences (read from past lesson history)
  3. Present 2-3 options via SMS
  4. On selection: book the make-up; deduct from package (if applicable)
                   or mark as a free make-up (if policy allows)
  5. Confirm to family + teacher.
```

### 5. End-of-month billing routine

```
Cron routine on the 1st of each month →
  1. Generate invoices for each family covering the prior month's
     lessons + package purchases + autopay subscriptions
  2. SendGrid email each family their invoice
  3. For families on autopay: trigger Stripe charge
       On success: mark invoice paid in TeachWorks
       On decline: SMS the family + retry per dunning sequence
                    (matches Stripe skill's dunning pattern)
  4. POST QBO journal entries:
       Debit AR / Bank (per family)
       Credit Lesson Revenue
       Credit Package Liability (for un-consumed packages — a deferred
                                  revenue accounting nuance)
  5. Aging report to admin for collections follow-up on past-due.
```

### 6. Teacher payroll prep

```
Cron routine end-of-pay-period →
  1. For each teacher, aggregate lessons taught in the period (only
     attended lessons count; no-shows don't pay the teacher in most
     models)
  2. Compute pay: lessons × per-lesson rate (with adjustments for
     premium services, group classes, etc.)
  3. Generate the teacher pay statement
  4. Push to Gusto/ADP for payroll processing (see gusto skill)
  5. Email teacher their statement for transparency.
```

### 7. Recital / event RSVPs

```
Triggered by admin creating an event in TeachWorks → Routine fires →
  1. Email + SMS all relevant families with the event details + RSVP link
  2. Track responses; gentle reminder cadence to non-respondents
  3. Day-of-event: SMS reminder with logistics
  4. Post-event: thank-you note + photo/video link if applicable
                  (parental media consent already on file per family).
```

## Idempotency

TeachWorks's API does not consistently expose idempotency-key. For routine-driven writes:
- Lesson creation: dedupe by (student_id, teacher_id, datetime)
- Invoice creation: dedupe by family_id + billing_period
- Family / Student upserts: query by email before creating

## Webhooks

TeachWorks supports webhooks for major events:
- `lesson.scheduled`, `lesson.completed`, `lesson.no_show`, `lesson.canceled`
- `invoice.created`, `invoice.paid`, `invoice.overdue`
- `family.created`, `student.created`
- `package.purchased`, `package.depleted`

Signature verification: HMAC with per-subscription secret. Verify before processing.

For events not pushed, fall back to polling with `updated_since` filters.

## Rate limits

TeachWorks publishes per-account rate limits in their developer docs. Typically conservative (low double-digit r/s). 429 with `Retry-After`. Bulk operations (monthly billing, payroll prep) off-peak.

## What this skill does NOT cover

- **Curriculum content** — what's taught in a lesson is the teacher's domain; TeachWorks tracks the schedule + billing.
- **Music streaming integration** (Soundslice, ScoreFlash) — separate music-tutoring tools.
- **Test-prep platforms** (Albert, Magoosh) — separate content platforms; TeachWorks tracks the scheduling + billing wrapper.
- **Background-check execution** — runs through partners (Sterling, Checkr); TeachWorks tracks expiration dates only.
- **Marketing automation on minor student data** — be conservative; default to opt-in parent lists.

## References

- API: https://www.teachworks.com/api/
- FERPA basics: https://www.ed.gov/laws-and-policy/ferpa
- COPPA: https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-location credentials; minor-consent-aware communication routing)
