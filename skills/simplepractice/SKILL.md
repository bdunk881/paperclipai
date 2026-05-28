---
name: simplepractice
description: Use this skill when an AutoFlow agent needs to read or write data in SimplePractice — the practice-management platform for independent therapists, counselors, and small mental-health / allied-health practices. Pull client records / appointments / claims / invoices, react to appointment events, sync billing to QuickBooks, manage intake forms, push appointment reminders. Covers SimplePractice's API surface (currently partner-program only — full OAuth API in rollout) with the Client / Appointment / Claim / Invoice model, HIPAA + privilege discipline, and the workflow shape AutoFlow customers reach for (intake → onboarding, appointment booked → confirmation + reminder, claim filed → status tracking, payment received → QBO reconciliation).
---

# SimplePractice — therapy + healthcare practice management

SimplePractice is the dominant practice-management platform for AutoFlow's healthcare-vertical SMBs — independent therapists, counselors, psychologists, social workers, dietitians, speech therapists, occupational therapists, small group practices. It owns the EHR-lite + scheduling + claims + billing surface for solo and small-group health providers.

Use SimplePractice when the customer **provides clinical or therapeutic services billed via claims** (insurance + self-pay). For pure wellness/fitness without clinical claims → Mindbody. For office-bound non-clinical services → HubSpot + Calendly.

## Regulatory framing — start here

Healthcare integration carries **HIPAA and clinical-privilege constraints** that change every AutoFlow routine. Build defensively:

- **PHI (Protected Health Information)** flows through this skill — names, addresses, diagnosis codes, session notes, claim data are all PHI.
- **AutoFlow must have a BAA (Business Associate Agreement)** with the customer's practice. If a workspace hasn't signed BAA terms, **block SimplePractice integration** during install.
- **PHI must never appear in webhook URLs, logs, or third-party tools** without their own BAA — that means Slack, Mailchimp, and most marketing tools are NOT safe destinations for SimplePractice data. Route PHI only to other BAA-covered destinations.
- **Session content (therapy notes) is privileged**; never expose it through an AutoFlow surface that a non-clinician can see.

If you can't satisfy these, **don't ship the routine**. The reputational + regulatory cost of a HIPAA breach far exceeds the benefit of any single automation.

## When to reach for this skill

- **New client intake** (web form / consent docs signed) → onboarding routine without exposing PHI to non-BAA destinations.
- **Appointment booked** → confirmation + reminder routine (PHI-free messaging — e.g. SMS "Your appointment is tomorrow at 3pm" — no diagnosis or session content).
- **Appointment completed** → claim filing reminder, invoice generation.
- **Claim status change** (submitted, accepted, denied, paid) → financial routine to track AR and follow up on denials.
- **Payment received** → QBO reconciliation, statement-generation.
- **No-show pattern** → flag client for clinician review (NOT for external retention marketing).

## Authentication

SimplePractice's full public OAuth API is in **partner-program rollout** as of early 2026. For most AutoFlow customers, integration paths are:

- **Partner Program access** — OAuth 2.0 with scoped tokens once granted partner status. Standard authorization-code flow.
- **Customer-side data export** — for customers not yet on the partner API, AutoFlow can ingest SimplePractice's scheduled CSV exports + email-based notifications as a fallback.
- **Zapier/Make bridges** — last resort; PHI passes through their systems → require BAA verification.

When the OAuth API is generally available, AutoFlow's pattern is:

```
Authorization: Bearer <simplepractice-access-token>
```

Base URL: `https://api.simplepractice.com/` (rollout-pending; check partner docs at integration time)

## Core entity model

| Entity | What it is | PHI? |
|---|---|---|
| Practice | The provider's clinic | Some — practitioner identity |
| Practitioner | The provider (therapist, etc.) | Some |
| Client | The patient | **Yes** — name, address, DOB, diagnosis |
| Appointment | A session | Yes — links to client + clinical notes |
| Note (Progress Note) | Session documentation | **Yes — and privileged** |
| Claim | Insurance billing record | Yes — includes diagnosis + procedure codes |
| Invoice | Billing record (self-pay or post-claim balance) | Some — client + amount |
| Payment | Money received | Some |
| Document | Forms, releases, intake | Yes — depends on content |
| Diagnosis | ICD-10 code on a client | **Yes** |
| CPT Code | Procedure code on an appointment | Yes — implicitly reveals treatment type |

## Common AutoFlow workflows

### 1. New client intake → privacy-aware onboarding

```
SimplePractice webhook on client.created → Routine fires →
  1. Verify webhook signature
  2. PHI-safe routing:
       - Send a generic SMS via Twilio: "Welcome to {practice}! Your
         portal login is in your email."  (no diagnosis or note content)
       - Do NOT push intake details to a non-BAA marketing tool.
  3. Log to a BAA-covered audit table (the customer's own database)
     for the practitioner to review.
```

### 2. Appointment booked → PHI-free reminder

```
SimplePractice webhook on appointment.created → Routine fires →
  1. Schedule cron 24h before appointment.start_time:
       POST Twilio /Messages (Twilio has BAA): 
         "Appointment reminder for tomorrow at {time}. Reply 1 to confirm,
          2 to cancel."
       Do NOT include session type, diagnosis, or any clinical content.
  2. Schedule cron 1h before:
       SMS "Your session is in 1 hour."
  3. On inbound reply (1 = confirm, 2 = cancel):
       PATCH the appointment.status or fire the cancellation flow.
```

### 3. Claim filed → status tracking

```
SimplePractice webhook on claim.created → Routine fires →
  1. Log the claim in the workspace's BAA-covered claim-tracking table
       (claim_id, client_id, dos, cpt, charge_amount, expected_payment)
  2. Schedule cron 30 days later: GET claim status
     If still in "submitted" state → flag for follow-up
     If denied → fire denial-management routine (notify clinician to
                 review and refile or appeal)
     If paid (partial or full) → fire payment-reconciliation routine
  3. Update the workspace's AR-aging dashboard.
```

### 4. Payment received → QBO reconciliation

```
SimplePractice webhook on payment.received → Routine fires →
  1. GET /payments/{id} for amount + invoice_id + payer_type
       (insurance vs self-pay vs both)
  2. POST QBO /payment matched to the QBO invoice ID
       (an invoice should already exist from the claim or self-pay billing)
  3. PrivateNote: "SimplePractice payment {id}" (PHI-free reference)
  4. Update AR aging.
```

### 5. No-show clinical review (not external)

```
SimplePractice webhook on appointment.status (where status="no_show") →
Routine fires →
  1. Increment client's no-show count in a BAA-covered workspace table
  2. If count >= 3 in past 90 days:
       Surface to the practitioner's internal dashboard (NOT marketing
       tools). The decision to discharge a client for chronic no-shows
       is clinical, not automated.
  3. Practitioner reviews + decides next step manually.
```

## Idempotency

SimplePractice's emerging API documents idempotency-key support on Claim and Invoice creation. Use it. For client upserts, query by `email + DOB` (HIPAA-safe identity match) before creating.

## Webhooks (when available)

Subscribe via the partner API:

```
POST /webhooks
body:
  topic: "appointment.created"
  url: "https://autoflow.example/webhooks/simplepractice/{workspace_id}"
```

Signature verification: standard HMAC-SHA256 with a per-subscription secret. **Verify EVERY webhook** — accepting unsigned PHI is a HIPAA violation in itself (you'd be processing health data from an unverified source).

Webhook URLs should be **opaque** — do not embed customer or client identifiers in the path beyond the workspace_id. The path is logged at the edge layer.

## Rate limits

To be published. Until then, conservative defaults: 5 requests/sec, exponential backoff on 429.

## Data export fallback pattern

If a customer is on SimplePractice but not yet on the partner API, AutoFlow can:

1. Have the customer schedule a daily SFTP export from SimplePractice's reports module
2. Ingest the CSV to a workspace BAA-covered table
3. Run the same routines against the table rather than direct API calls

This bridges customers until partner API access is generally available, without leaking PHI through email-based exports.

## What this skill does NOT cover

- **EHR clinical documentation** (notes, treatment plans, assessments) — these are privileged. AutoFlow does not parse, summarize, or route them. Period.
- **Insurance eligibility verification** — SimplePractice has its own; not exposed via API.
- **Telehealth video** (Calmerry, Doxy.me) — handled inside SimplePractice's session UI; AutoFlow doesn't bridge.
- **Marketing automation on patient data** — illegal without explicit HIPAA-Authorization signed by the patient. AutoFlow customers requesting "marketing email to all my clients" must be redirected to a HIPAA-compliant marketing tool (e.g. Klara) AND collect Authorization first.
- **Public posts, testimonials, reviews involving patient identity** — never automate without explicit, written, HIPAA-Authorization.

## References

- API (rollout): https://developers.simplepractice.com/ (link valid post-GA)
- HIPAA basics for SaaS BAs: https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/index.html
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; PHI-handling guard at routine boundary)
