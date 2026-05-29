---
name: ezyvet
description: Use this skill when an AutoFlow agent needs to read or write data in ezyVet — the cloud-based practice-management platform for independent veterinary clinics, small animal hospitals, mixed-practice rural clinics, and specialty/emergency vet hospitals. Pull patients (animals) / clients (owners) / consults / invoices / orders / lab results, react to appointment and clinical events, push billing to QuickBooks, run vaccine/reminder cadences, manage referrals, automate boarding/grooming bookings. Covers ezyVet's REST API + OAuth 2 auth, the Client / Patient / Contact / Consult / Invoice / Product / Health Reminder model, vet-specific regulatory considerations (controlled substances, state vet board rules, USDA), and the workflow shape AutoFlow customers reach for (appointment reminders, vaccine recare, lab follow-up, end-of-day reconciliation).
---

# ezyVet — veterinary practice management

ezyVet is the leading cloud-based practice-management platform for AutoFlow's veterinary SMBs — small-animal companion clinics, mixed practices (small + large animal), specialty/referral hospitals, emergency vets, mobile vet practices. It competes with Cornerstone (also Idexx), AVImark, eVetPractice in this market; ezyVet's cloud-native shape and modern API make it the AutoFlow-friendly choice.

Use ezyVet when the customer is a **veterinary clinic or hospital**. For human-medical → athenahealth / SimplePractice. For dental → Dentrix.

## Regulatory framing — start here

Veterinary practice operates under a **different regulatory shape than human healthcare**:

- **HIPAA does NOT apply** to vet practices (patient is an animal, not a "covered entity individual" under HIPAA). However, **state veterinary practice acts** govern client/patient confidentiality, and most states impose obligations similar to physician-patient privilege.
- **Controlled substances (DEA Schedule II-V drugs)** require strict logging — every dispense + every disposal. Cannot lose, modify, or obscure these records. **NEVER automate controlled-substance ordering or dispensing** beyond what the prescribing vet has manually approved.
- **State vet board rules** vary widely on advertising, telemedicine, and the vet-patient-client relationship (VPCR). When in doubt, route to human review.
- **USDA / APHIS** rules apply to large-animal and food-animal practices for health certifications (interstate animal movement, export). Health certificates are sensitive legal documents.
- **Client communications**: owners can authorize sharing with other parties (groomer, boarder, trainer, breeder), but default is confidential to the owner.

These constraints affect what AutoFlow routines can automate vs surface to a human.

## When to reach for this skill

- **Appointment reminder cadence** — confirmations + 24h reminders for visits.
- **Vaccine / health-reminder cadence** — annual booster reminders are core to vet revenue.
- **Boarding / grooming bookings** — many vet clinics also offer boarding + grooming services.
- **Lab result follow-up** — clinical interpretation requires the vet; AutoFlow surfaces and tracks.
- **Referral routing** — for specialty practices, manage inbound referrals from primary-care vets.
- **End-of-day reconciliation** — production, collections, AR-aging.
- **Prescription refill request** → vet approval pipeline (NEVER auto-refill controlled substances).
- **Animal-welfare follow-up** — post-surgery check-in, post-procedure recovery survey.

## Authentication

ezyVet uses **OAuth 2.0** with the client-credentials grant:

```
Authorization: Bearer <ezyvet-access-token>
```

Tokens are issued per integration partner per clinic. Access tokens last ~1 hour; the partner credentials get exchanged for fresh tokens.

Base URL: `https://api.ezyvet.com/v2/`

Region-specific endpoints exist (NZ-origin product with AU, US, EU regions); confirm at install.

For multi-location vet hospital groups, each clinic typically has its own ezyVet instance + credentials. AutoFlow connection records hold one set per location.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Client (Contact) | The pet owner (a human) | Multiple pets per client |
| Patient | The animal | Linked to one or more clients |
| Species + Breed | Animal taxonomy | Used for default protocols + dosing |
| Consult | A clinical visit (the encounter record) | Where exams + diagnosis + treatment happen |
| Appointment | A scheduled time slot | Becomes a consult when checked in |
| Resource | A vet, tech, room, equipment | What's being scheduled |
| Invoice | Bill for products + services | Linked to consult or standalone |
| Product | Drug, vaccine, supply, service line | The pricebook |
| Health Reminder | Vaccine/recheck/wellness recall | Drives recare revenue |
| Lab Order / Lab Result | Diagnostic test order + reported result | In-house + reference lab integration |
| Health Status | Patient flags (FIV+, deceased, etc.) | Affects workflow visibility |
| Communication | Logged email/SMS/phone with client | Audit trail |

## Common AutoFlow workflows

### 1. Appointment reminder cadence

```
Cron routine daily OR webhook on appointment.created → Routine fires →
  1. Identify appointments at 24-hour reminder window
  2. SMS via Twilio:
       "Hi {client_first}, {patient_name}'s appointment is tomorrow at
        {time} with {vet}. Reply C to confirm or R to reschedule."
  3. Veterinary advertising rules generally allow including animal name
     + visit type but check state board rules; default to PHI-free style
  4. On reply: process as confirm/reschedule.
```

### 2. Vaccine recare cadence — the revenue spine

```
Cron routine daily →
  1. Query health reminders where due_date in next 30 days, status = open,
     and no scheduled appointment for the patient covering the reminder
  2. Group by client (multiple pets per household → consolidated outreach)
  3. SMS the client:
       "Hi {client_first}, {patient_name} is due for {reminder_type}.
        Reply BOOK to schedule or call us at {phone}."
  4. On BOOK reply: open scheduling routine — surface to front-desk
     queue with the client's preferred-time history
  5. For non-responders: at 14d cron, send a postal reminder via
     a mail-merge routine (mailing-house integration)
  6. Track reminder lifecycle (sent, booked, completed, lapsed) for
     the recare-conversion dashboard.
```

### 3. Lab result → vet review → client communication

```
Webhook on lab_result.received → Routine fires →
  1. Surface to the ordering vet's inbox (in ezyVet's clinical queue)
  2. DO NOT message the client until the vet has reviewed + interpreted
  3. After vet review (tracks via the consult's clinical-note update):
       If vet drafted a client message, route via SMS/email
       If vet scheduled a recheck, route booking confirmation
  4. Vet review is the gating step; AutoFlow surfaces + tracks, never bypasses.
```

### 4. End-of-day reconciliation

```
Cron routine at clinic-close +1h →
  1. Aggregate the day's invoices:
       service revenue (consults, surgeries, dental)
       product revenue (food, OTC, supplies)
       vaccine revenue
       boarding/grooming revenue
       discounts + write-offs
  2. POST QBO entries:
       Debit Bank (collected)
       Credit Service Revenue (per category)
       Debit AR (for invoices on payment terms)
       Track adjustments separately
  3. Email/Slack the practice manager a daily summary.
```

### 5. Prescription refill request → vet approval

```
Inbound refill request (client portal, phone, pharmacy) → Routine fires →
  1. Check the prescription's last fill date + remaining refills
  2. For NON-controlled-substance refills:
       Surface to the prescribing vet's inbox for approval
       Vet approves → AutoFlow processes the dispense + invoice
  3. For CONTROLLED-SUBSTANCES (Schedule II-V):
       NEVER auto-process. Always surface to the vet for new
       prescription decision. State and federal DEA rules require
       individualized vet judgment + new Rx for each fill on most
       controlled substances.
  4. Log every refill attempt + decision to the controlled-substance
     audit trail (separate ledger).
```

### 6. Post-procedure check-in

```
Cron routine 1-3d after surgery/procedure consults →
  1. SMS the client:
       "How is {patient_name} doing after their {procedure} on {date}?
        Reply 1 (great), 2 (okay), 3 (concerns)."
  2. On 3 reply: open a callback routine — route to vet tech for phone
     check-in
  3. On 1 or 2 + 7 days later: optional follow-up at suture-removal
     window if applicable
  4. Tag visits with post-op outcomes for the clinical-quality dashboard.
```

### 7. Boarding / grooming booking

```
Booking request (web form, phone, walk-in) → Routine fires →
  1. Check vaccine compliance — most boarding facilities require
     current bordetella, DHPP, rabies (cats: FVRCP, FeLV often)
  2. If vaccines current: confirm the boarding/grooming appointment
  3. If vaccines lapsed: SMS the client with the gap + offer to combine
     a vaccine visit with the boarding drop-off
  4. Front-desk task: prep boarding intake paperwork.
```

## Idempotency

ezyVet's API supports idempotency-key on some POST endpoints. Use it for routine-driven invoice creation + appointment booking. For client + patient upserts, dedupe by:
- Client: phone + email
- Patient: (client_id, name, species, dob) is functionally unique within a clinic

## Webhooks

ezyVet supports webhooks via the integration partner portal:

```
Common topics:
- appointment.created, appointment.canceled, appointment.no_show
- consult.created, consult.updated
- invoice.created, invoice.paid
- lab_result.received
- patient.created, patient.updated, patient.deceased
- health_reminder.due
```

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

For events not pushed, fall back to incremental polling.

## Rate limits

ezyVet publishes per-integration rate limits in their partner portal. Typically conservative for a small-clinic API. 429 with `Retry-After`. Bulk reports (vaccine-due, AR-aging) run off-peak.

## What this skill does NOT cover

- **In-house lab equipment integration** (IDEXX VetLab, Heska) — these run through ezyVet's lab module; AutoFlow consumes the resulting lab_result records, doesn't drive instruments.
- **Reference lab connections** (Antech, IDEXX Reference Labs) — same: ezyVet handles the connection.
- **Digital imaging** (DICOM viewers) — separate clinical surface; out of scope.
- **DEA controlled-substance ordering** — strict regulatory process; never automate.
- **Health certificates for interstate animal movement** — USDA-regulated; veterinarian must personally examine + sign.
- **Marketing automation on client lists** — for vet practices, typical email/SMS marketing is OK (no HIPAA) but state vet board rules may restrict; default to opt-in lists only.

## References

- API: https://www.ezyvet.com/integrations/integration-development/
- Developer docs (partner access): https://api.ezyvet.com/docs
- DEA controlled-substance rules (US): https://www.deadiversion.usdoj.gov/
- AVMA practice standards: https://www.avma.org/resources-tools/avma-policies
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-clinic credentials; controlled-substance routing guard; state-vet-board nuance flagged at install)
