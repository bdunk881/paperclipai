---
name: dentrix
description: Use this skill when an AutoFlow agent needs to read or write data in Dentrix — the practice-management platform for independent dental practices. Pull patients / appointments / treatment plans / insurance claims / billing, react to appointment events, push payments to QuickBooks, manage recall (recare) reminders, sync hygiene schedules, and run claims-status routines. Covers Dentrix's evolving API surface (legacy local-DB era + the newer Dentrix Ascend cloud APIs), HIPAA + dental-specific compliance discipline, the Patient / Appointment / Provider / Treatment / Claim / Ledger model, and the workflow shape AutoFlow customers reach for (appointment reminder cadence, recare cycle, claim status follow-up, end-of-day reconciliation).
---

# Dentrix — dental practice management

Dentrix is the dominant practice-management platform for AutoFlow's dental SMBs — independent general-dentistry practices, specialty practices (orthodontics, oral surgery, periodontics, endodontics, pediatric dentistry), small group practices, and DSO-managed offices. Henry Schein (the parent) owns the broader dental supply + tech ecosystem; Dentrix is its software anchor.

Use Dentrix when the customer is a **dental practice** (general or specialty). For mental-health practices → SimplePractice. For general medical → athenahealth or similar.

## Dentrix variants — know which you're targeting

There are two **distinct products** under the Dentrix brand with **different APIs**:

- **Dentrix G-series (Dentrix G7, G8, ...)** — the **on-premises / local-database** product, historically dominant. APIs are limited and often require a partner program; many integrations interact via the **Dentrix Developer Program (DDP)** or, increasingly, the **DXOne** middleware that exposes a cloud-accessible facade over local installs.
- **Dentrix Ascend** — the **cloud-native** product. Has a more modern REST API. Newer practices and DSOs are migrating onto Ascend.

Always confirm which Dentrix variant the customer is on at install. The integration shape changes significantly between them.

## Regulatory framing — start here

Dental practice data is **PHI under HIPAA**. The same discipline as the SimplePractice skill applies:

- **BAA required** before any production integration. Block install without a signed BAA.
- **PHI must never flow to non-BAA destinations** (Slack, Mailchimp, marketing tools without their own BAA).
- Patient communications going outside the practice should be PHI-free by default (no diagnosis or treatment details in SMS/email reminders unless the practice has obtained explicit HIPAA-Authorization from the patient).
- Dental imagery (intraoral photos, X-rays) is PHI plus often privileged for malpractice purposes. Never route through AutoFlow surfaces a non-clinician can see.

## When to reach for this skill

- **Appointment reminder cadence** — confirmations + 7-day/24-hour reminders (PHI-free).
- **Recare (recall) cycle** — 6-month hygiene recall is the heartbeat of dental practice revenue; automated outreach drives a significant share of bookings.
- **Insurance claim filed** → status tracking, denial management, follow-up cadence.
- **Treatment plan presented but not accepted** → financial-options follow-up routine.
- **Payment received** → QBO reconciliation, statement closeout.
- **Appointment no-show / late-cancel** → fee per practice policy + rescheduling outreach.
- **End-of-day reconciliation** → production, collections, AR aging.

## Authentication

### Dentrix Ascend (cloud, preferred when available)

Standard OAuth 2.0 authorization-code flow with refresh tokens:

```
Authorization: Bearer <ascend-access-token>
```

Base URL: depends on the practice's region / tenant — confirm at install.

### Dentrix G-series (on-premises, via partner program)

Two integration paths:
1. **DDP partner API** — requires Henry Schein partner status. Connection is via a server-side bridge installed at the practice.
2. **DXOne / 3rd-party middleware** (Open Dental Integration Services, Vyne Dental, etc.) — vendors that bridge local Dentrix to a cloud API.

AutoFlow's pattern for G-series: typically require the customer to be on a supported bridge product before allowing the integration.

For both variants, the `ticketSync` connection record captures (variant, bridge_type, credentials, region) at install.

## Core entity model

| Entity | What it is | PHI? |
|---|---|---|
| Practice | The dental office | Mostly non-PHI |
| Provider | A dentist or hygienist | Some |
| Operatory | A treatment chair/room | Operational |
| Patient | The patient | **Yes — full PHI** |
| Family | A billing-group of patients (a household) | Yes |
| Appointment | A scheduled visit | Yes |
| Treatment Plan | Proposed procedures + costs | Yes (clinical) |
| Procedure | A completed treatment (CDT-coded) | Yes |
| Insurance Plan | Coverage info per insurance carrier | Some |
| Subscriber | The insurance policyholder | Yes |
| Claim | Insurance claim record | Yes (includes diagnosis/procedure codes) |
| Ledger | Patient/family financial transactions | Some |
| Recall / Recare | Scheduled future-visit reminder track | Yes |

## Common AutoFlow workflows

### 1. Appointment reminder cadence (PHI-free)

```
Cron routine daily (or webhook on appointment.created):
  1. Identify appointments at 7-day and 24-hour reminder windows
  2. Send via Twilio SMS (PHI-aware — no procedure details):
       7-day:   "Hi {first_name}, you have a dental appointment on {date}
                 at {time}. Reply C to confirm or R to reschedule."
       24-hour: "Reminder: appointment tomorrow at {time}."
  3. On C reply: update appointment.confirmed_at; cancel further reminders.
  4. On R reply: open a rescheduling routine — route to front-desk queue.
  5. NO procedure codes, diagnoses, or treatment-plan content in outbound
     messaging — those go through the patient portal only.
```

### 2. Recare (recall) cycle — the revenue heartbeat

```
Cron routine daily →
  1. Query patients with recall_due_date in the next 14 days who don't
     have an upcoming scheduled hygiene appointment
  2. For each, send a PHI-free SMS via Twilio:
       "Hi {first_name}, you're due for your cleaning! Reply BOOK to
        schedule or call us at {phone}."
  3. On BOOK reply: open scheduling routine — surface to front-desk
     queue with the patient's upcoming availability window
  4. For non-responders after 14 days: email reminder + phone call to
     front-desk task list
  5. After 60 days unresponsive: mark as "recall lapsed" and route to
     reactivation cohort.
```

### 3. Insurance claim → status tracking

```
Webhook on claim.submitted (or daily poll) → Routine fires →
  1. Log to BAA-covered claim-tracking table:
       (claim_id, patient_id, dos, total_charge, insurance_plan_id)
  2. Schedule cron 30 days later:
       Query claim status
       If still "pending": flag for front-desk follow-up
       If denied: fire denial-management routine — surface to office mgr
                  with the denial reason, never auto-resubmit
       If paid (partial or full): fire payment-reconciliation routine
  3. Update AR-aging dashboard.
```

### 4. Treatment plan presented but unaccepted

```
Cron routine weekly →
  1. Query treatment plans presented in last 30 days where patient_acceptance
     is not "accepted" and total_value > threshold
  2. For each:
       Schedule front-desk outreach task with financial-options reminder
       (CareCredit financing, in-house payment plans)
  3. Front-desk reaches out personally — NOT an automated marketing email
     mentioning the unaccepted treatment (HIPAA/professional courtesy).
```

### 5. End-of-day reconciliation

```
Cron routine at 7pm (after operatory close) →
  1. Pull the day's:
       production (procedures completed today × fees)
       collections (payments received today, by source: patient vs insurance)
       adjustments (write-offs, courtesy discounts)
       AR aging snapshot
  2. POST QBO entries:
       Debit Bank (collections)
       Credit Production Revenue
       Debit Adjustments expense
       (Match against insurance receivable + patient AR)
  3. Email/Slack the office-manager a PHI-free daily summary:
       "Today: $12,400 production, $9,800 collected, AR > 90d: $14,200."
```

### 6. No-show / late-cancel fee

```
Webhook on appointment.no_show or appointment.canceled_late → Routine fires →
  1. Check practice policy (no-show fee, late-cancel window)
  2. If policy applies:
       Add ledger charge for the fee amount
       PHI-free SMS to patient:
         "We charged a {fee} no-show fee per our policy. Reply HELP for
          questions or to reschedule."
  3. Tag in practice CRM for retention review if recurring no-shows.
```

## Idempotency

Dentrix's API maturity varies by variant; for routine-driven writes, dedupe via natural keys:
- Appointments: `(patient_id, datetime, provider_id)` is functionally unique
- Ledger entries: practice-side reference number
- For Ascend: idempotency-key support is being rolled out in newer endpoints — use it where available

## Webhooks (Ascend)

Subscribe via the Ascend partner portal:

```
Topics commonly subscribed:
- appointment.created, appointment.updated, appointment.canceled, appointment.no_show
- patient.created, patient.updated
- claim.submitted, claim.status_changed
- payment.posted
- treatment_plan.presented
```

Signature verification: standard HMAC-SHA256. Verify before processing — accepting unsigned PHI is itself a HIPAA violation.

For G-series: webhooks usually come via the bridge middleware; verification mechanics depend on the bridge.

## Rate limits

Ascend: published in the partner portal — typically conservative (low double-digit r/s).

G-series via DDP/bridge: limited by the bridge's bandwidth + the practice's local server capacity. Don't hammer.

## What this skill does NOT cover

- **Clinical charting / perio probing data** — the digital chart is privileged + complex; AutoFlow does not parse, summarize, or expose chart content.
- **Imaging** (X-rays, intraoral photos) — PHI plus often subject to professional standards; out of scope.
- **Eligibility verification** — runs through clearinghouses (Vyne Dental, etc.) not Dentrix directly.
- **Lab order tracking** — typically through separate lab-tracking software.
- **Treatment-plan marketing on patient data without explicit HIPAA-Authorization** — illegal.
- **Public testimonials/reviews involving patient identity** — never automate without written Authorization.

## References

- Dentrix Developer Program: https://www.dentrix.com/products/dentrix/integrate
- Dentrix Ascend developers: https://www.dentrixascend.com/api (per-tenant access on partnership)
- ADA dental codes (CDT): https://www.ada.org/publications/cdt
- HIPAA basics for SaaS BAs: https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/index.html
- AutoFlow integration shape: `src/ticketSync/` (variant-aware connection: ascend OAuth path OR G-series bridge path; PHI-handling guard at routine boundary)
