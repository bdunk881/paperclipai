---
name: tribute
description: Use this skill when an AutoFlow agent needs to read or write data in Tribute (Tribute Technology family — Frontrunner, Funeral Director's Life, FrontRunner Professional) — the practice-management + case-management platform for funeral homes, cremation services, cemeteries, and adjacent death-care SMBs. Pull cases / families / decedents / services / contracts / payments, react to case-stage events, push billing to QuickBooks, manage obituary publishing, coordinate post-need vital-records routines, and handle pre-need contract management. Covers Tribute's API + auth, the Family / Decedent / Case / Service / Contract model, death-care-specific regulatory considerations (FTC Funeral Rule, vital records, pre-need trust accounting, cemetery interment rights), and the workflow shape AutoFlow customers reach for (case onboarding, obituary publishing, vital-records filing, payment + insurance assignment routines).
---

# Tribute Technology — funeral home + cemetery management

Tribute Technology (parent of Frontrunner Professional, Funeral Director's Life, ASD Answering Service, and others) is a leading practice-management platform for AutoFlow's death-care SMBs — funeral homes, cremation services, cemeteries, monument companies, and adjacent operators. Used by thousands of funeral homes across the US + Canada.

Use Tribute when the customer is a **funeral home, cremation provider, or cemetery**. Different from any other vertical because death-care operates under specific FTC rules + state vital-records procedures + significant emotional context.

## Operational framing — start with respect

Death-care is high-touch, emotionally weighted work. AutoFlow routines must reflect this:

- **Outbound communications** are with grieving families. Tone, timing, and channel matter enormously. NEVER use auto-marketing-style language; default to warm + brief + human-routed for anything beyond pure logistics.
- **Speed matters** but composure matters more. A 10-minute response to a death-call is appropriate; a marketing-feel automated SMS is not.
- **Pricing transparency** is FTC-regulated (Funeral Rule); price disclosures must be accurate + accessible.
- **Privacy of the deceased** + their family is paramount. PII flows here but most isn't HIPAA (the deceased isn't a "living individual" under HIPAA after death, but state laws and funeral home professional conduct codes apply).
- **Stewardship of remains** — facilities must always know where the deceased is + chain of custody. Any AutoFlow routine touching this must respect the underlying physical workflow + state requirements.

## When to reach for this skill

- **Death call → case onboarding** — initial intake at first contact (family calls, hospital releases body, hospice transfer).
- **Service planning** — coordinate funeral arrangements, viewing/visitation, service, disposition.
- **Obituary publishing** — to newspaper(s), website, social media (with family approval).
- **Vital records (death certificate)** — order certified copies from county/state; pre-need vs at-need procedure varies.
- **Insurance assignment** — life-insurance proceeds often pay funeral costs; assignment-of-benefits paperwork.
- **Payment management** — final-need (at-need) and pre-need contracts; trust accounting for pre-need.
- **Aftercare** — post-service grief resources, anniversary check-ins, holiday remembrance.
- **Cemetery interment** — coordinate burial / inurnment + lot management.

## Authentication

Tribute Technology offers API access primarily through partner-program integration:

```
Authorization: Bearer <tribute-access-token>
```

OAuth-style or API-key auth depending on which Tribute product (Frontrunner Professional vs Funeral Director's Life vs other). AutoFlow's connection record captures product + credentials at install.

Base URL varies by product; verify per current Tribute documentation at integration time.

Multi-location funeral chains: each location typically has its own account. AutoFlow connections pin per-location.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Case | A death-care service engagement | Central organizing unit |
| Decedent | The deceased | Identity + vital info for death certificate |
| Family | The bereaved family (legal next-of-kin + relatives) | Authorization + billing |
| Authorizing Agent | Legally-authorized person to make funeral decisions | Typically next-of-kin per state hierarchy |
| Contract | At-need or pre-need agreement | Defines services + payment |
| Service | The funeral service / visitation / memorial / committal | Logistics + attendees |
| Disposition | Burial, cremation, donation, etc. | Final treatment of remains |
| Merchandise | Casket, urn, vault, memorial products | Inventory |
| Cremation | The cremation procedure record | State-regulated, requires permit |
| Obituary | Published memorial text | Newspaper + website + social |
| Vital Record | Death certificate certified copy | State-issued |
| Pre-Need Contract | Future-service agreement (often funded by trust or insurance) | Trust-accounting required |
| Cemetery Lot | A grave site or columbarium niche | If customer operates cemetery |
| Aftercare Touch | Post-service grief support contact | Stewardship |

## Common AutoFlow workflows

### 1. Death call → case onboarding

```
Triggered by an inbound death call (logged manually by staff or via
answering service like ASD) → Routine fires →
  1. Surface the call to the on-call director immediately —
     don't auto-respond beyond confirming intake
  2. After initial director conversation, gather case-intake data:
       Decedent demographics (legal name, DOB, DOD, place of death,
       cause)
       Family contact info (authorizing agent + key contacts)
       Initial wishes (burial vs cremation, religious preferences)
       Insurance / payment intent
  3. Create the Case in Tribute
  4. Schedule arrangement meeting within 24-48 hours (per family)
  5. Light SMS confirmation to family AFTER director's personal call:
       "Confirmed — we'll meet on {date} at {time}.
        Director {name} will be your point of contact at {phone}.
        Anything we can do in the meantime, please call."
  6. Internal team Slack alert: new case, on-call director assigned,
     hospital/hospice notified.
```

### 2. Arrangement meeting → service planning

```
After family arrangement meeting (staff inputs decisions into Tribute) →
Routine fires →
  1. Generate service plan document (FTC Goods & Services Statement)
  2. Coordinate with affected parties:
       Clergy / officiant (if requested)
       Cemetery (if burial)
       Crematory (if cremation)
       Caterer / floral vendors (if used)
       Music / video provider
  3. Schedule each milestone in the service calendar
  4. SMS family with the agreed plan summary
       Include the funeral director's direct line
       Note any outstanding items needing family input
```

### 3. Obituary publishing routine

```
Triggered after family approves obituary text → Routine fires →
  1. Submit to designated newspaper(s) via their API or email
       (typically families pick 1-2 papers — local + hometown)
  2. Publish to the funeral home's website with photo + service info
  3. Push to social channels with family-approved frame:
       Facebook for visibility
       Always include "Service details: {link}" with the funeral home's
       page (not direct social link to private family content)
  4. Confirm to family that obituary is live + share links.
  5. Track condolence messages submitted via website for the
     family's review.
```

### 4. Vital records (death certificate) ordering

```
After cause-of-death is finalized + filed → Routine fires →
  1. Verify the family's certified-copy quantity requested
     (typical: 5-10 copies; needed for insurance, banks, property
     transfers, government — never auto-order more than family
     authorized)
  2. Submit electronic death registration via state EDRS system
     (where available) OR coordinate with attending physician for
     paper certificate
  3. Order certified copies from county/state vital records
  4. On receipt: log + distribute to family per arrangement
  5. State vital records timelines vary widely (some same-day,
     some weeks); track + communicate ETAs to family.
```

### 5. Insurance assignment + payment management

```
Triggered when family elects to assign insurance to cover funeral costs →
Routine fires →
  1. Identify the policy + carrier (family provides)
  2. Verify policy is in force (call carrier or use death-care
     insurance assignment specialist like Homesteaders, Funeral
     Services Investment)
  3. Generate assignment-of-benefits paperwork
  4. Send to family for signature via DocuSign
  5. On signed assignment: submit to carrier per their process
  6. Track claim status; usually 7-30 days to fund
  7. Apply received funds to case balance + remit any excess to
     family per assignment terms.
  8. POST QBO entries for receivable tracking.
```

### 6. Aftercare touchpoints

```
Scheduled cadence after service completed →
  1. Day 7 after service: handwritten note from funeral director
                          (physical, not email — staff-routed task)
  2. Day 30: light email with grief resources + community support
              links (NEVER include marketing language)
  3. Day 90: invite to grief support group (if offered by funeral home)
  4. 1-year anniversary: thoughtful remembrance message:
       "Thinking of you and {decedent_first} this {anniversary date}."
  5. Holidays (1st Thanksgiving, 1st Christmas/Hanukkah after loss):
       Brief sympathy note
  6. ALL outbound aftercare communications get a staff review before
     send — automation can suggest timing + draft, but a human
     reviews before sending. Death-care aftercare is the single most
     sensitive communication AutoFlow handles; getting tone wrong
     damages the funeral home's reputation permanently.
```

### 7. Pre-need contract management + trust accounting

```
For pre-need (purchased in advance of death) →
  1. Pre-need funds typically held in trust per state law
     (not in operator's operating account); this is fiduciary money
  2. Annual trust-account reconciliation:
       Verify trust balance matches sum of all pre-need contracts
       Compute trust earnings (interest/gains) allocated per state rules
  3. When a pre-need beneficiary dies (case becomes at-need):
       Identify the pre-need contract
       Calculate any inflation / overage / shortfall vs current pricing
       Apply trust funds to case
       Remit any surplus to family per contract
  4. State variations are wide; pre-need fraud has been a real
     industry problem historically; AutoFlow surfaces signals but
     trust-account compliance lives with the operator + their CPA.
```

## Death-care compliance

- **FTC Funeral Rule** — federal regulation requires funeral homes to provide General Price List (GPL) + Casket Price List (CPL) + itemized Goods & Services Statement. Pricing must be transparent + non-discriminatory. AutoFlow routines surfacing prices must use the operator's current published lists.
- **State vital-records procedures** — death certificate filing varies by state; EDRS (Electronic Death Registration System) where available speeds things up.
- **Cremation authorization** — typically requires statutory next-of-kin authorization + waiting period (24-48 hours common); never bypass.
- **Pre-need trust regulations** — varies wildly by state; some states require 100% in trust, others 70-90%; fiduciary discipline required.
- **Cemetery interment rights** — state laws govern lot ownership, transferability, and burial rights.
- **Funeral procession permits** — some states require permits + escort coordination with local law enforcement.
- **Body release** — chain-of-custody from place of death to funeral home is regulated; documentation required.

## Idempotency

Tribute's API has variable idempotency support across products. For routine-driven writes, dedupe via natural keys (case_id, decedent_id).

## Webhooks

Tribute publishes webhooks for major events (varies by product):
- `case.created`, `case.stage_changed`
- `obituary.published`
- `service.scheduled`
- `payment.received`
- `pre_need_contract.fulfilled`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Tribute publishes per-account rate limits in partner portal. Conservative cadence appropriate; 429 with `Retry-After`.

## What this skill does NOT cover

- **Embalming + restorative arts** — clinical work performed by licensed embalmers; out of automation scope.
- **Cremation processing** — physical cremation requires state-licensed crematory operator.
- **Casket + merchandise sourcing** — purchasing handled by funeral home + suppliers.
- **Cemetery groundskeeping** — physical maintenance.
- **Grief counseling** — clinical service performed by licensed counselors; funeral home aftercare may include resources but not clinical care.
- **Marketing automation on bereaved-family lists** — explicit ethical no-go.

## References

- API: https://www.tributetech.com/ (partner program access)
- FTC Funeral Rule: https://www.ftc.gov/business-guidance/resources/complying-funeral-rule
- NFDA (National Funeral Directors Association) best practices: https://nfda.org/
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce + secrets-store; per-location credentials; staff-review-gate on ALL family-facing communications)
