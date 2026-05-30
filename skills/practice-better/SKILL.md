---
name: practice-better
description: Use this skill when an AutoFlow agent needs to read or write data in Practice Better — the practice-management platform for nutritionists, registered dietitians, holistic health coaches, naturopathic doctors, functional-medicine practitioners, and integrative-health solo practitioners. Pull clients / sessions / programs / forms / invoices, react to session and form events, push billing to QuickBooks, manage protocol delivery, automate intake + reminder cadences, and run package-renewal routines. Covers Practice Better's REST API + auth, the Client / Session / Program / Form / Protocol / Invoice model, integrative-health-specific considerations (scope of practice variance by credential, supplement recommendation discipline, HIPAA + state nutrition-counseling laws), and the workflow shape AutoFlow customers reach for (intake automation, session reminders, protocol delivery, package depletion → renewal).
---

# Practice Better — nutrition + integrative-health practitioner management

Practice Better is the leading practice-management platform for AutoFlow's nutrition + integrative-health solo SMBs — registered dietitians (RD), nutritionists (CNS, CN), naturopathic doctors (ND), holistic health coaches (IIN, NBC-HWC, NS), functional-medicine practitioners, chiropractors with nutrition focus, herbalists, fitness coaches with nutrition scope. Used by ~50,000+ practitioners.

Use Practice Better when the customer is a **solo or small-team nutrition / integrative-health practitioner**. For mental-health solo → SimplePractice. For general medical → athenahealth. For dental → Dentrix. For veterinary → ezyVet.

## Regulatory framing — start here

Integrative-health practice has a **complex scope-of-practice + jurisdictional layer** AutoFlow routines must respect:

- **HIPAA may apply** if the practitioner is a covered entity (e.g. RDs taking insurance) or a business associate; if not, state nutrition-counseling laws still impose confidentiality + record-retention obligations. Default to HIPAA-equivalent discipline.
- **Scope of practice varies by credential AND state**. An RD can give medical nutrition therapy + diagnose; a CNS/CN can typically give nutrition counseling but not medical diagnosis; a health coach typically can't prescribe diets or claim treatment. AutoFlow MUST NOT auto-generate communications that exceed the practitioner's scope (e.g. cannot draft "treatment protocols" for a health coach in a state where that constitutes unlicensed practice of nutrition).
- **Supplement recommendations** — practitioners often recommend supplements; certain states regulate this for non-RDs. Don't auto-populate supplement protocols without practitioner review.
- **Medical disclaimers** — outbound content should include appropriate "not medical advice" disclaimers if the practitioner isn't licensed for medical care.
- **Insurance billing** — RDs increasingly take insurance (medical nutrition therapy CPT codes 97802-97804); claim cycles + denial management apply (similar to SimplePractice / athenahealth).

## When to reach for this skill

- **Intake automation** — pre-session questionnaires (food diary, health history, goals).
- **Session reminders** — confirmations, day-before, hour-before.
- **Session notes + follow-up** — post-session protocol delivery, action items.
- **Program / package management** — most nutrition work is sold as 3-month or 6-month programs.
- **Form completion tracking** — clients are often expected to log food/symptoms; track + remind.
- **Protocol delivery** — supplement + dietary recommendations sent to client portal.
- **Recurring client cadence** — biweekly/monthly check-ins.
- **Insurance claim filing** (RDs taking insurance) — same shape as SimplePractice's claim workflow.

## Authentication

Practice Better's API is partner-program-mediated:

```
Authorization: Bearer <practice-better-access-token>
```

OAuth or API-key depending on partner agreement.

Base URL: `https://api.practicebetter.io/` (verify with current docs at integration time)

Single-practitioner accounts dominate; for small group practices, AutoFlow connections pin per-account.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Practitioner | The credentialed health professional | Has credential type + state license info |
| Client | The patient/client | Demographic + health profile |
| Session | A scheduled appointment (in-person, telehealth, async) | Source for billing + scope |
| Program | A multi-session package or service bundle | Often the way nutrition work is sold |
| Package | Pre-paid session bundles | Like a punch card |
| Form | A questionnaire (intake, food diary, symptom tracker, follow-up) | Pre/post-session use |
| Note (Session Note) | Practitioner's clinical record of session | Privileged |
| Protocol | Recommended supplements + dietary changes | Practitioner-authored |
| Invoice | Billing record | Linked to session/program |
| Payment | Money received | Card, ACH, insurance |
| Group | Group coaching cohort | Some practitioners run groups |
| Resource | Educational handout shared with client | Tracked for engagement |
| Custom Lab Order | Functional lab requisition (GI Map, hormone panel, etc.) | Tracked but ordered externally |

## Common AutoFlow workflows

### 1. Intake automation routine

```
Webhook on client.created OR new package purchase → Routine fires →
  1. Send welcome email with intake-form links:
       Health history questionnaire
       3-day food diary
       Goals + expectations form
       (PHI-aware: NO clinical content in subject line)
  2. Cron 3 days later: gentle reminder if forms incomplete
  3. Cron 7 days later: 2nd reminder + offer to chat about any blockers
  4. On all forms complete: notify practitioner forms ready for review
                            + schedule first session
  5. Forms can be heavy (food diary alone is 3 days × 5 entries);
     intake completion rate is a real KPI.
```

### 2. Session reminder cadence

```
Cron routine daily →
  1. At 24h before:
       SMS via Twilio (PHI-free for non-HIPAA-strict practices):
       "Hi {first_name}, your session with {practitioner.first} is
        tomorrow at {time}. {portal_link}"
  2. At 1h before:
       SMS: "Session in 1 hour. {video_link}" (if telehealth)
  3. On-no-show after 15 min: auto-cancel session per policy +
     SMS practitioner ("client no-show; routine your call")
```

### 3. Post-session protocol delivery

```
Webhook on session.completed → Routine fires →
  1. Practitioner writes session note + protocol in Practice Better
  2. AutoFlow does NOT auto-author the protocol (scope of practice
     + safety) — practitioner authors, AutoFlow distributes
  3. On protocol-published event:
       Send to client portal
       SMS client: "Your follow-up protocol is ready in your portal:
                    {link}"
       Schedule cron 7d later: check-in on protocol adherence
  4. Resource attachments (handouts) tracked for client engagement.
```

### 4. Form completion tracking (food diary, symptom log)

```
Cron routine daily during active programs →
  1. For each active client, check completion status of expected forms
     (food diary, symptom log, supplement log) per their program cadence
  2. For 2+ days behind: SMS reminder
       "Quick reminder to log today's meals in your portal: {link}"
  3. For chronic non-completion (>50% blanks over 2 weeks):
       Surface to practitioner for outreach (compliance + the
       client's health goals are linked; if they're not logging,
       they may be struggling — practitioner judgment matters)
  4. NEVER guilt-trip via automation; this is health behavior.
```

### 5. Package depletion → renewal

```
Cron routine daily →
  1. Query clients on a session-pack where remaining_sessions <= 2
  2. If actively engaged (recent sessions + form completions):
       Send renewal-offer email + SMS
       "You have 2 sessions left in your current package — here are
        renewal options: {portal_link}"
  3. If less engaged (gaps in attendance, low form completion):
       Surface to practitioner for personal conversation (often
       client is mid-life-event; renewal pressure is wrong)
  4. Track renewal rate as KPI.
```

### 6. Insurance claim filing (RDs accepting insurance)

```
Webhook on session.completed (where insurance_billable=true) →
Routine fires →
  1. Generate claim per CPT (97802 new patient nutrition assessment,
     97803 follow-up, 97804 group nutrition) + ICD-10 code
  2. Submit via Practice Better's clearinghouse integration
     (or external clearinghouse if not integrated)
  3. Track claim status (same shape as SimplePractice / athenahealth):
       Submitted → pending
       Pending 30d → flag for follow-up
       Denied → fire denial-management routine
       Paid → reconcile + apply to client balance
  4. Update AR aging.
```

### 7. Group coaching cohort routines

```
For practitioners running group programs →
  1. Generate cohort welcome packet on enrollment
  2. Schedule cohort sessions on shared calendar
  3. Pre-cohort: send pre-work
  4. Mid-cohort: progress check (forms + 1-on-1 invite for stragglers)
  5. Post-cohort: testimonials + program-2 upsell + grad community access
  6. Group cohort retention is the lever for many practitioners' MRR.
```

## Idempotency

Practice Better's API supports idempotency on writes. For routine-driven creates, use deterministic keys.

For client upserts, dedupe by email before creating.

## Webhooks

Practice Better publishes webhooks for major events:
- `client.created`, `client.updated`
- `session.scheduled`, `session.completed`, `session.canceled`
- `form.completed`
- `invoice.paid`
- `package.completed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Practice Better publishes per-account rate limits. Typically conservative for solo-practitioner accounts; 429 with `Retry-After`.

## What this skill does NOT cover

- **Functional lab ordering** (GI Map, hormone panels, food sensitivity tests) — runs through external labs (Genova, DUTCH, Vibrant); Practice Better tracks but doesn't drive ordering.
- **Custom supplement formulations** — separate compounding tools.
- **Continuing education / CEUs** — practitioner-specific tracking; outside scope.
- **Marketing automation on patient health data** — illegal without explicit HIPAA-Authorization (and state-law analog).
- **Symptom interpretation / diagnosis suggestions** — clinical judgment; never automated.

## References

- API: https://practicebetter.io/ (partner program)
- IOM nutrition scope of practice (RD): https://www.cdrnet.org/
- CNS scope of practice: https://nutritionspecialists.org/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key + secrets-store; per-practitioner credentials; scope-of-practice guard on outbound communications; HIPAA-equivalent discipline by default)
