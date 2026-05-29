---
name: buildertrend
description: Use this skill when an AutoFlow agent needs to read or write data in Buildertrend — the project-management platform for residential remodelers, custom home builders, specialty contractors, and small commercial construction. Pull jobs / leads / selections / change orders / schedules / time clock data, react to job-stage events, push billing to QuickBooks, manage subcontractor coordination, track selection deadlines, automate change-order approvals. Covers Buildertrend's REST API + OAuth, the Lead / Job / Subcontractor / Selection / Change Order / Daily Log / Time Clock model, construction-specific lien-law + safety-doc compliance, and the workflow shape AutoFlow customers reach for (lead → job conversion, selection deadlines → client outreach, change order → approval cadence, daily-log compliance).
---

# Buildertrend — residential + small-commercial construction management

Buildertrend is the leading construction-management platform for AutoFlow's construction SMBs — residential remodelers, custom home builders, specialty contractors (kitchens/baths, roofing, siding, decks/pools), small commercial GCs. Used by ~1M+ users across small-to-mid construction businesses; competes with CoConstruct, Houzz Pro, JobTread at the small/mid end.

Use Buildertrend when the customer is a **construction company managing multi-week to multi-year residential or small-commercial projects** with subs, selections, change orders, schedules. For pure trade-installation work (single-day HVAC swap) → Jobber / ServiceTitan. For very large commercial GCs → Procore / PlanGrid.

## When to reach for this skill

- **Lead converts to job** — onboarding routine, contract send (DocuSign), initial scheduling.
- **Selection deadline approaching** — client must pick finishes (tile, paint, fixtures); missed selections delay the job. Outreach cadence is critical.
- **Change order initiated** → client approval routine, sub-and-tech notification, schedule re-balance.
- **Daily log captured** → compliance archiving (some jurisdictions require daily logs as part of the project record).
- **Subcontractor scheduling** → notification when their slot is upcoming, confirmation, no-show handling.
- **Time clock data** → labor cost allocation per job, QBO journal entry, payroll prep.
- **Draw request / progress billing** → progress-based invoice generation per contract milestone.
- **Punch list closeout** — final-walk items must be resolved before final payment.

## Authentication

Buildertrend uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <buildertrend-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

Base URL: `https://api.buildertrend.com/` (partner program access required)

Multi-builder operators (franchises, multi-location GCs) typically have one Buildertrend account per business entity. AutoFlow connection records pin per-account.

## Core entity model

Construction-management is workflow-heavy; the model reflects that:

| Entity | What it is | Notes |
|---|---|---|
| Lead | A prospective client / project | Pre-contract |
| Job | A contracted project | The central organizing unit |
| Client | The homeowner / project owner | Linked to job |
| Subcontractor | A trade partner (electrician, plumber, etc.) | Linked to jobs via assignments |
| Selection | A client decision point (tile choice, paint color, etc.) | Has deadline + cost impact |
| Change Order | A scope/cost change after contract | Requires client approval |
| Schedule Item | A task with start/end + assigned resource | Drives Gantt + crew planning |
| Daily Log | Daily progress record (with photos) | Compliance + memory |
| Time Clock Entry | Worker clock-in/out per job | Source for labor cost |
| Document | Contract, plan, spec, photo | Job document library |
| Invoice / Bill | Progress billing + sub bills | Linked to job + draw schedule |
| Draw | A milestone-based progress payment | Per contract |
| Punch List Item | A final-walk to-do | Gates final payment |
| Warranty Request | Post-completion issue | Customer warranty period tracking |

## Common AutoFlow workflows

### 1. Lead converts to job → onboarding

```
Webhook on lead.converted → Routine fires →
  1. Generate the construction contract via DocuSign template
     (template per job type — kitchen remodel vs new build vs roof)
     with the lead's scope + price + schedule details
  2. POST DocuSign envelope (see docusign skill)
  3. On envelope-completed:
       Create the job in Buildertrend (POST /jobs)
       Set initial schedule + selection-deadline calendar
       Send the client welcome email (SendGrid) with portal access
  4. Slack alert to PM: "New job kicked off: {client_name} - {job_type}"
```

### 2. Selection deadline cadence

```
Cron routine daily →
  1. Query selections where deadline within 14 days, status = open
  2. By deadline window:
       14d out: email client a friendly heads-up + portal link to make
                the selection
       7d out: SMS + email + portal nudge
       3d out: SMS + email + assistant phone-call task
       1d out: PM gets a personal Slack alert — escalate to phone call
       0d/overdue: PM Slack alert with schedule-impact analysis
                    (a missed selection delays the schedule downstream)
  3. On selection made: cancel further reminders, fire next-step routine.
  4. Selection conversion rate is a tracked PM KPI.
```

### 3. Change order → client approval

```
Webhook on change_order.created → Routine fires →
  1. SMS + email the client with the change order summary:
       price delta, schedule delta, scope description, attachments
       Direct link to the portal for one-click approval
  2. Wait for response. If no response in 48 hours:
       PM Slack alert — personal follow-up needed (schedule downstream
       depends on this decision)
  3. On approval: 
       Update job contract value
       PATCH the schedule per the change order's schedule impact
       Notify affected subs of the change
       POST QBO entry for the contract-value adjustment (if billing
       progress-based)
  4. On decline: PM routine to discuss alternatives with client.
```

### 4. Daily log compliance

```
Daily routine (or webhook on daily_log.created) →
  1. Verify the day's log includes required elements per the workspace's
     policy: weather, crew present, work completed, materials delivered,
     issues encountered, photos
  2. If incomplete: Slack reminder to the PM/superintendent before
     end-of-day
  3. Archive completed logs to durable storage (compliance audit trail —
     some jurisdictions require 7-year retention for construction
     records, longer for insurance/litigation discovery)
  4. Aggregate daily logs into weekly progress reports for the client.
```

### 5. Time clock → labor cost + QBO

```
Cron routine end-of-week →
  1. Aggregate time clock entries by job + worker
  2. Compute labor cost: hours × hourly_rate (with overtime multipliers)
  3. POST QBO entries:
       Debit COGS - Labor (per job)
       Credit Accrued Wages (paid via payroll routine separately)
  4. Update each job's actual-vs-budget labor variance dashboard
  5. PM Slack alert if any job is >10% over labor budget — recovery
     conversation needed.
```

### 6. Draw request / progress billing

```
Triggered by completion of a contract milestone (foundation poured,
framing complete, drywall finished, etc.) → Routine fires →
  1. PM marks milestone complete in Buildertrend
  2. Generate the progress invoice per contract draw schedule:
       % complete on milestone X × contract value − previously billed
  3. POST QBO /invoice
  4. SendGrid email the client with the invoice
  5. If lender-funded (construction loan): also notify the bank's
     draw-administrator with the certification documents
  6. Track AR aging per job.
```

### 7. Punch list → final payment gate

```
Walk-through completed → Routine fires →
  1. Capture punch list items in Buildertrend
  2. Schedule cron daily to track resolution:
       Items not resolved within 7 days: PM Slack alert + sub follow-up
       All items resolved: SMS client + schedule final walk
  3. Final walk completed + signed off:
       Trigger final invoice routine
       Send warranty information packet
       Schedule 30/60-day follow-up surveys
       Tag in HubSpot for testimonial-request cohort
```

## Construction-specific compliance considerations

- **Lien laws** vary by state — preliminary notices, mechanic's liens, lien waivers. Buildertrend has document templates; AutoFlow can track deadlines + remind staff but **must NEVER file liens automatically** (legal action requiring attorney + contractor judgment).
- **Sub-contractor lien-release management** — collecting conditional + unconditional lien waivers from subs at each draw is critical. Surface missing waivers before releasing payment.
- **Safety / OSHA records** — daily logs + injury reports may be required by OSHA. Don't delete or alter once captured (OSHA recordkeeping rules: OSHA 300 forms, 5-year retention).
- **Building permit + inspection sign-offs** — track these as compliance milestones; missing inspections can void warranty + insurance.
- **Insurance certificates** — subs should have current Workers Comp + General Liability COIs; surface expiring COIs before scheduling work.
- **Right-to-cancel** — many jurisdictions require a 3-day right-to-cancel on residential remodeling contracts. AutoFlow contract-send routines should respect this period before starting any chargeable work.

## Idempotency

Buildertrend's API does not consistently expose idempotency-key. For routine-driven writes:
- Jobs: dedupe by external_id (set to AutoFlow's correlation ID)
- Invoices / draws: dedupe by job_id + milestone before creating
- Schedule items: dedupe by (job_id, title, start_date)

## Webhooks

Buildertrend publishes webhooks for major events:
- `lead.created`, `lead.converted`
- `job.created`, `job.status_changed`
- `selection.created`, `selection.deadline_approaching`
- `change_order.created`, `change_order.approved`
- `daily_log.created`
- `invoice.paid`

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

For events not pushed, fall back to incremental polling.

## Rate limits

Buildertrend publishes per-account rate limits in their partner portal. Typical conservative cadence: 429 with `Retry-After`. Heavy reads (week-end labor aggregation, daily-log compliance sweep) off-peak.

## What this skill does NOT cover

- **Procore / PlanGrid** — enterprise construction platforms, different scale.
- **Estimating / takeoff software** (PlanSwift, STACK) — pre-Buildertrend tools; AutoFlow consumes Buildertrend's estimate output.
- **Detailed accounting** beyond GL sync — full job-cost accounting still lives in QBO/Sage300/Foundation for many GCs.
- **Heavy CAD/BIM** — not Buildertrend's scope.
- **Equipment fleet management** — separate tools (B2W, EquipmentShare).

## References

- API: https://developers.buildertrend.com/ (partner program access required)
- OSHA recordkeeping: https://www.osha.gov/recordkeeping
- Lien-law primer (state-specific): https://www.levelset.com/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-account credentials; lien/legal guardrails on action routines)
