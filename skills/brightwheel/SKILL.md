---
name: brightwheel
description: Use this skill when an AutoFlow agent needs to read or write data in Brightwheel — the practice-management platform for childcare centers, preschools, daycares, after-school programs, and small home-based childcare. Pull students / families / classrooms / attendance / payments, react to attendance and billing events, push tuition revenue to QuickBooks, automate enrollment workflows, manage parent communications, run waitlist + waitlist conversion routines. Covers Brightwheel's API + auth, the Student / Family / Guardian / Classroom / Attendance / Payment model, childcare-specific compliance considerations (state licensing, ratios, immunization tracking, CACFP food program, COPPA + minor data), and the workflow shape AutoFlow customers reach for (enrollment intake → onboarding, attendance compliance, tuition autopay, daily parent reports).
---

# Brightwheel — childcare + preschool management

Brightwheel is the dominant practice-management platform for AutoFlow's childcare SMBs — daycare centers, preschools, Montessori programs, after-school programs, summer camps, home-based childcare. Used by 50,000+ programs across the US covering infant-care through pre-K.

Use Brightwheel when the customer operates **early-childhood education or childcare** (birth to ~6 years, plus after-school). For K-12 schools → enterprise platforms (PowerSchool, etc.) outside SMB scope. For lesson-based education above school age → TeachWorks.

## When to reach for this skill

- **Enrollment intake → onboarding** — application received, accept/waitlist, send onboarding packet, collect required docs (immunizations, emergency contacts, allergies).
- **Daily attendance** — record check-in/out, calculate billable days, flag absences for follow-up.
- **Tuition autopay** — monthly/weekly billing run, retry on decline, communicate with families.
- **Daily parent reports** — meals, naps, diaper changes, photos, learning activities (Brightwheel handles natively; AutoFlow may augment with weekly summaries).
- **Waitlist management** — when capacity opens, contact next family on waitlist; conversion-to-enrollment routine.
- **Required-document compliance** — track expiring immunization records, custody documents, food allergies; remind families before lapses.
- **Staff schedule + ratio compliance** — state-mandated student-to-staff ratios by age group; alert when current attendance + staff schedule would breach ratios.
- **CACFP (Child and Adult Care Food Program) reporting** — federally funded food reimbursement program many centers participate in; requires per-meal-per-child logging.

## Authentication

Brightwheel's public API is primarily partner-program-mediated. Access paths:

- **Brightwheel Partner Program API** — partner agreement + OAuth credentials per program (center). Standard authorization-code flow.
- **CSV / data export** — fallback for non-partner customers; daily/weekly exports ingested to AutoFlow workspace tables.

```
Authorization: Bearer <brightwheel-access-token>
```

Base URL: `https://api.mybrightwheel.com/` (partner-only; confirm current path at integration time)

Multi-center operators (chains, franchises) typically have one Brightwheel account per center; AutoFlow connections pin per-center.

## Regulatory framing

Childcare is **heavily regulated state-by-state**. The shape varies but common constraints:

- **State licensing** — annual or biennial inspections; documented policies + procedures + staff qualifications required.
- **Student-to-staff ratios** — state-mandated by age group (e.g. 4:1 for infants, 12:1 for preschoolers). Breaching ratios can suspend the license.
- **Immunization records** — typically required at enrollment + tracked through age changes; some states allow medical/religious exemptions with documentation.
- **Background checks** for all staff — annual or biennial renewal; AutoFlow tracks expiration.
- **Mandated reporting** — staff are mandated reporters of suspected child abuse/neglect. Not an AutoFlow workflow but flagged for awareness; AutoFlow must NEVER obscure or alter incident reports.
- **COPPA / FERPA-adjacent** — children under 13 require parental consent for data collection; FERPA may apply to programs receiving federal funds.
- **Custody documents** — for children of separated parents, custody orders control who can pick up the child + who has decision rights. Critical to track accurately.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Program (School) | A childcare center | Top-level scope |
| Classroom (Room) | A specific age-group room (infant, toddler, etc.) | Has capacity + ratio req |
| Student | The child | Linked to one or more guardians |
| Guardian | A parent/authorized adult | Multiple per student (parents, grandparents) |
| Family | The billing unit (typically a household) | Source of payment |
| Enrollment | Status of a student at a program | Active, waitlist, withdrawn |
| Attendance | Daily check-in / check-out records | Source for billing + ratios |
| Plan / Tuition | The billing rate structure | Per classroom, schedule, age |
| Invoice | Billing record | Linked to family |
| Payment | Money received | Card, ACH, autopay |
| Staff | A teacher / caregiver | Schedule + qualifications |
| Activity / Learning | Daily activity log (meals, naps, etc.) | Parent-visible reports |
| Document | Immunization record, custody order, emergency contact | Compliance attachments |
| Allergy / Medical Alert | Critical health information | Surfaced for staff in feeding/admin contexts |

## Common AutoFlow workflows

### 1. Enrollment intake → onboarding

```
Web form submission OR Brightwheel waitlist-to-active conversion →
Routine fires →
  1. Generate the onboarding packet via DocuSign:
       enrollment agreement, tuition acknowledgment, immunization
       form, emergency contacts, photo/media consent, custody info
  2. Email/SMS the family with the packet
  3. Schedule cron 5d after send:
       Missing docs → friendly reminder
       Missing immunization record (state-required) → harder reminder
       (cannot enroll without; state law)
  4. On completion: create the student record in Brightwheel, assign
     to classroom, set start date.
  5. Tag in HubSpot for ongoing family relationship.
```

### 2. Daily attendance compliance + ratios

```
Continuous routine during operating hours →
  1. Pull current attendance + staff present (live)
  2. By classroom + age group, check ratio against state rules:
       infant_ratio = state_max_ratio[infant]  // e.g. 4
       current_infant_ratio = infants_present / staff_in_infant_room
  3. If approaching ratio limit (within 1 student):
       Slack alert to director: "Infant room near ratio limit:
                                 5 students, 2 staff (max 4:1)"
  4. If exceeding:
       URGENT alert + page director — state license at risk
       Recommend moving staff or temporarily denying drop-off
  5. End-of-day: archive the day's max-ratio snapshot per room for
     compliance audit trail.
```

### 3. Tuition autopay run

```
Cron routine on the 1st (or per family's billing cycle) →
  1. For each family on autopay:
       Generate invoice for the billing period
       Charge via Stripe (Brightwheel has integrated payments or
       AutoFlow can route to external Stripe — see stripe-payments skill)
  2. On decline:
       SMS family: "Tuition payment didn't process. Please update payment
                    in the Brightwheel app or call us at {phone}."
       Schedule retry routine (1d, 3d, 7d)
       After 14 days unresolved: surface to director for personal
       conversation (potential withdrawal — sensitive)
  3. POST QBO entries:
       Debit Bank/AR
       Credit Tuition Revenue (per classroom for cost-center reporting)
       Credit Deferred Revenue if billing covers future periods
```

### 4. Required-document expiration tracking

```
Cron routine daily →
  1. For each student, check document expirations:
       Immunization records (next-due dates per CDC schedule)
       Custody orders (renewal dates if applicable)
       Allergy action plans (typically annual)
       Special-needs IEPs/IFSPs (annual review)
  2. At 60d before expiration: email family with the renewal request
  3. At 30d: SMS reminder
  4. At 14d: director Slack alert — non-compliant student may need
              to be excluded per state rule
  5. At expiration: director must decide — state licensing risk
                   varies; AutoFlow surfaces, director decides.
```

### 5. Waitlist conversion

```
Triggered when a slot opens in a classroom → Routine fires →
  1. Pull waitlist for the matching age/classroom, sorted by priority
     (typically join date + sibling preference + staff-family preference)
  2. Contact the top family:
       SMS + email: "A spot just opened in our {age group} classroom.
                     Reply YES within 48 hours to claim it."
  3. On YES: trigger the enrollment intake workflow (workflow 1)
  4. On no response in 48h: move to next family on waitlist
  5. Track waitlist-to-enrollment conversion rate.
```

### 6. CACFP meal-count reporting

```
Daily routine (CACFP participants) →
  1. Pull meal counts per child per meal (breakfast, lunch, snack)
     from the day's activity log
  2. Reconcile against per-child enrollment status (eligible meals)
  3. Aggregate for the month-end reimbursement claim
  4. Generate the CACFP claim file in the state's required format
  5. Surface to director for review before submission (claim errors
     can trigger audit + recoupment of past payments)
  6. Track reimbursement received vs claimed for revenue forecasting.
```

### 7. Daily/weekly parent communication summary

```
End-of-day routine →
  1. Brightwheel sends daily activity logs natively (meals, naps,
     diapers, photos, activities); don't duplicate
  2. AutoFlow can augment with weekly summaries:
       Email: "{student.first}'s week at a glance" with curated
              photos + milestones noted by teachers
  3. Helps parent engagement + retention metrics
```

## Idempotency

Brightwheel's API supports idempotency on payment + enrollment writes. For routine-driven inserts (notes, activities), dedupe via natural keys (student_id + datetime + activity_type).

## Webhooks

Brightwheel supports webhooks for major events (partner-program features):
- `attendance.checked_in`, `attendance.checked_out`
- `enrollment.created`, `enrollment.changed`
- `payment.completed`, `payment.failed`
- `document.uploaded`
- `incident.reported`

Signature verification: HMAC with per-subscription secret. Verify before processing.

For events not pushed, fall back to incremental polling.

## Rate limits

Brightwheel publishes per-program rate limits in their partner portal. Typically conservative; 429 with `Retry-After`. Heavy compliance reports (state inspection prep) off-peak.

## What this skill does NOT cover

- **K-12 school management** (PowerSchool, Infinite Campus) — out of childcare scope.
- **Curriculum platforms** (Teaching Strategies GOLD, HighScope) — pedagogy tracking; separate tools.
- **Subsidy management** (state subsidies for low-income families) — varies by state; some Brightwheel customers manage outside the platform.
- **Photography/yearbook services** — separate vendors.

## References

- API: https://developer.mybrightwheel.com/ (partner program access required)
- CACFP: https://www.fns.usda.gov/cacfp/child-and-adult-care-food-program
- Child Care Aware (state licensing lookup): https://www.childcareaware.org/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-center credentials; state-licensing-aware compliance guards; custody-document discipline at communication boundary)
