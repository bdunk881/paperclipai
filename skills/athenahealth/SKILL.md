---
name: athenahealth
description: Use this skill when an AutoFlow agent needs to read or write data in athenahealth (athenaOne, athenaClinical, athenaCollector) — the cloud-native EHR + practice-management platform for primary care, internal medicine, pediatric, multi-specialty, and small-to-mid medical groups. Pull patients / appointments / encounters / claims / orders, react to appointment and claim events, sync billing to QuickBooks, run no-show outreach, automate referrals, manage care-gap closure routines. Covers athenahealth's More Disruption Please (MDP) Marketplace API with practice-scoped OAuth, the Patient / Appointment / Encounter / Claim / Order model, HIPAA + clinical-quality discipline, and the workflow shape AutoFlow customers reach for (appointment reminders, claim status tracking, referral close-the-loop, care-gap outreach).
---

# athenahealth — primary care + multi-specialty medical practice management

athenahealth (athenaOne, athenaClinical, athenaCollector, athenaCommunicator) is the dominant cloud-native EHR + practice-management + revenue-cycle platform for AutoFlow's primary-care + multi-specialty medical SMBs. Practices ranging from 1-provider FQHC look-alikes to 50-provider multi-specialty groups run on it. Different from SimplePractice (mental-health solo) and Dentrix (dental) — athena targets general medical workflows.

Use athenahealth when the customer is a **medical practice** (primary care, internal medicine, pediatrics, OB/GYN, specialty groups). For mental-health solo → SimplePractice. For dental → Dentrix.

## Regulatory framing — start here

Medical practice data is **PHI under HIPAA**. Same conservative discipline as SimplePractice + Dentrix:

- **BAA required** before any production integration. Block install without BAA.
- **PHI must never flow to non-BAA destinations** (Slack, Mailchimp, marketing tools without BAA).
- Outbound patient messaging is **PHI-free by default** (no diagnosis, lab results, or clinical content in SMS/email) unless the patient has signed HIPAA-Authorization.
- Clinical content (encounter notes, lab results, prescriptions) is privileged. Never route through AutoFlow surfaces a non-clinician can see.
- **Quality measure data** (HEDIS, MIPS gaps) is PHI when patient-attributable; aggregate it before any non-clinical reporting.

## When to reach for this skill

- **Appointment reminder + no-show outreach** — confirmations, 24h reminders, no-show rebook routines.
- **Claim filed → status tracking** — submission → acceptance/denial → payment → reconciliation.
- **Referral close-the-loop** — when a PCP refers to a specialist, track that the referral was completed (huge gap-closure leverage for value-based-care practices).
- **Care-gap outreach** — patients overdue for preventive care (mammograms, colonoscopies, A1c checks, immunizations).
- **Lab result follow-up** — abnormal results need provider review + patient outreach (provider review NEVER auto-skipped).
- **EOB posting** — insurance EOBs hit athenaCollector; AutoFlow can mirror to QBO + AR-aging.
- **Patient outreach for documentation** — collect ROIs, consents, intake forms ahead of visits.

## Authentication

athenahealth uses **OAuth 2.0** through the **More Disruption Please (MDP) Marketplace** partner program:

```
Authorization: Bearer <athena-access-token>
```

Access tokens last ~1 hour; refresh tokens rotate. MDP partners get scoped access per practice ID (`practiceid`) that authorizes the integration.

Production vs Preview: `api.athenahealth.com` (production) vs `api.preview.platform.athenahealth.com` (preview/sandbox). Always confirm env.

Base URL: `https://api.platform.athenahealth.com/v1/{practiceid}/`

**Practice scoping**: every API call is scoped to a single `practiceid`. AutoFlow's connection record stores `(practiceid, mdp_credentials)` per connection. Multi-practice groups need separate connections per practiceid (though for some endpoints `practiceid=Default` aggregates).

## Core entity model

| Entity | What it is | PHI? |
|---|---|---|
| Practice | The medical organization | Some |
| Department | A clinical department/location within a practice | Some |
| Provider | A clinician (MD, DO, NP, PA) | Some |
| Patient | The patient | **Yes** |
| Appointment | A scheduled visit | Yes |
| Encounter | A documented clinical visit | Yes (heavy clinical) |
| Chart | The patient's clinical record | **Yes — privileged** |
| Order | An order for a service (lab, imaging, referral, Rx) | Yes |
| Lab Result | A reported lab value | Yes |
| Claim | Insurance claim record | Yes |
| Payment / EOB | Insurance EOB or patient payment | Some |
| Care Gap | Open clinical-quality gap (HEDIS / MIPS / pay-for-perf) | Yes when patient-attributable |
| Patient Case | A documented patient communication thread | Yes |
| Document | An attached document (scanned form, faxed report) | Yes |

## Common AutoFlow workflows

### 1. Appointment reminder cadence (PHI-free)

```
Cron routine OR webhook on appointment.created → Routine fires →
  1. Schedule 7d-before reminder + 24h-before reminder + same-day-of
     reminder at provider start time
  2. SMS via Twilio (HIPAA-BAA): NO procedure details
       7d:   "Hi {first_name}, you have an appointment on {date} at
              {time}. Reply C to confirm or R to reschedule."
       24h:  "Reminder: appointment tomorrow at {time}."
       Same-day: "Your appointment is in 1 hour."
  3. On C reply: update appointment.status; cancel further reminders
  4. On R reply: open rescheduling routine — route to front-desk queue
  5. NO labs, dx, or visit reason in outbound messaging.
```

### 2. No-show outreach + rebook

```
Webhook on appointment.no_show → Routine fires →
  1. Within 2 hours of no-show:
       SMS the patient: "We missed you for your {time} appointment.
                         Reply BOOK to reschedule or call us at {phone}."
  2. If no response in 48h: route to front-desk task list for personal
     phone call
  3. Tag in patient record (BAA-covered side table): no-show count
     If 3+ no-shows in 90 days, surface to clinical staff (clinical
     decision, NOT automated discharge)
```

### 3. Claim status tracking + denial management

```
Webhook on claim.status_change OR daily poll → Routine fires →
  1. Log to BAA-covered claim-tracking table:
       (claim_id, patient_id, dos, total_charge, payor, status)
  2. On "denied": fire denial-management routine
       Categorize denial code (CO-15 = missing data, CO-29 = timely
       filing, etc.)
       Surface to billing staff with the actionable next step
       (NEVER auto-resubmit — denials need human judgment)
  3. On "paid": fire EOB-posting routine — match to expected, write
     adjustment if partial payment, mirror to QBO
  4. Update AR-aging dashboard.
```

### 4. Referral close-the-loop

```
Webhook on order.created (where order.type = "REFERRAL") → Routine fires →
  1. Log the referral with target specialty + specialist
  2. Schedule cron 30d, 60d, 90d later:
       Check if a Document (consult note) has been received from the
       specialist matching this referral
       If yes: mark closed, notify referring provider
       If no: SMS patient — PHI-free reminder to follow up
              + task to front-desk to call specialist office
              + task to provider to consider re-referring if patient lost
  3. Value-based-care reporting metric — % referrals closed within 90d
     is a tracked KPI.
```

### 5. Care-gap outreach (preventive care)

```
Cron routine weekly →
  1. Pull patients with open care gaps (preventive care overdue):
       - Mammogram (women 50-74, q2y)
       - Colorectal screening (50-75, q1-10y depending on method)
       - A1c (diabetics, q3-6mo)
       - Annual wellness visit (Medicare patients, 1/yr)
       - Childhood immunizations on schedule
  2. PHI-aware outreach via patient portal preferred:
       Send portal message: "You're due for your annual wellness exam.
                             Book here: {portal link}"
       SMS fallback (PHI-free): "Time for your annual checkup.
                                  Reply BOOK or call us at {phone}."
  3. Track outreach + booking in care-gap-closure dashboard.
  4. Quality-measure performance feeds into value-based-care contracts
     (HEDIS, MIPS).
```

### 6. Lab abnormal → provider review pipeline

```
Webhook on lab_result.received → Routine fires →
  1. Compare result to athena's flagged-abnormal indicator + reference range
  2. If abnormal AND not yet reviewed by a provider:
       Surface to the ordering provider's inbox (in athena's Order Inbox)
       Do NOT message the patient yet — provider must review first
  3. After provider review (tracks via the result's reviewed-by field):
       If provider sets patient-message draft, route through patient
       portal (BAA-covered)
       Schedule follow-up appointment if ordered
  4. Provider review is the gating step. AutoFlow surfaces and tracks;
     never bypasses.
```

### 7. EOB posting → QBO + AR aging

```
Webhook on payment.posted OR daily import →
  1. For each EOB/payment line item:
       Match payment to claim → invoice in QBO
       Compute contractual adjustment (charged − contracted = adjustment)
       POST QBO entries:
         Debit Bank (payment received)
         Debit Contractual Adjustment (write-off)
         Credit AR
  2. Update payer-mix dashboard + AR-aging report.
```

## Idempotency

athenahealth supports idempotency on some POST endpoints but coverage is uneven. For routine-driven writes, dedupe via natural keys:
- Appointments: `(patient_id, departmentid, datetime)` is functionally unique
- Patient Cases: subject + first-message body hash within a 1-minute window
- Document attachments: filename + content hash before POST

For Patient + Provider lookups, prefer `patientid` and `providerid` references over name matching (HIPAA-safe; reduces ambiguity errors).

## Webhooks

athenahealth offers **change events** (subscription-based push). Subscribe via MDP integration setup:

Common topics:
- `appointment.created`, `appointment.canceled`, `appointment.no_show`
- `claim.status_change`
- `payment.posted`
- `order.created`, `order.completed`
- `patient.case.created`
- `document.received`

Signature verification: standard HMAC-SHA256 with per-subscription secret. **Verify before processing** — accepting unsigned PHI is itself a HIPAA violation.

For events not pushed, fall back to incremental polling with `showsince=` timestamps.

## Rate limits

- Practice-scoped throttling — published in MDP partner portal; typically conservative.
- 429 returns `Retry-After`.
- Bulk-data endpoints exist for compliance reporting; use them rather than iterating single GETs.

## What this skill does NOT cover

- **Clinical decision support** (athena's CDS rules) — managed in athena's clinical-quality module, not API-driven.
- **e-prescribing** (Surescripts integration) — runs through athena's prescription module; AutoFlow doesn't route Rx data.
- **HIE / payer connections** — managed in athena's interoperability layer.
- **Marketing automation on patient data** — illegal without explicit HIPAA-Authorization.
- **Public reviews / testimonials with patient identity** — never automate without written Authorization.
- **Clinical documentation drafting** — privileged + regulated (scope-of-practice); AutoFlow doesn't auto-draft notes.

## References

- MDP: https://www.athenahealth.com/programs/marketplace
- Developer portal (partner access required): https://docs.athenahealth.com/api/
- HEDIS measures: https://www.ncqa.org/hedis/measures/
- HIPAA basics: https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/index.html
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; practiceid pinning; PHI-handling guard at routine boundary; BAA gate on install)
