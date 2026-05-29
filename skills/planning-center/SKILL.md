---
name: planning-center
description: Use this skill when an AutoFlow agent needs to read or write data in Planning Center — the church-management suite for protestant churches, small mid-size congregations, and faith-based nonprofits. Covers the suite's distinct apps (People, Services, Giving, Groups, Calendar, Check-Ins, Registrations, Publishing), the People-as-central-entity model, donor management + tax-receipting discipline, volunteer scheduling, and the workflow shape AutoFlow customers reach for (new-visitor follow-up, recurring giving management, volunteer scheduling, group attendance tracking, year-end tax receipts).
---

# Planning Center — church management for protestant churches

Planning Center is the leading church-management system for AutoFlow's faith-based SMBs — protestant churches (small to mid-size, ~50-5,000 weekend attendance), parachurch ministries, faith-based nonprofits. Used by 75,000+ churches worldwide; the de-facto standard for the modern mid-size church.

Use Planning Center when the customer is a **protestant church or faith-based organization** running services, groups, giving, and volunteer scheduling. For Catholic parishes → ParishSOFT / WeShare common. For Jewish congregations → ShulCloud common. For mosques/temples → various.

## When to reach for this skill

- **New-visitor follow-up** — first-time guest fills out a connection card → automated welcome sequence + pastor handoff.
- **Recurring giving management** — donor adds/cancels/lapses a recurring gift → engagement routine.
- **Volunteer scheduling + reminders** — confirm volunteers for upcoming Sunday positions, fill last-minute gaps.
- **Group attendance** — small group leaders mark attendance; absence patterns trigger pastor follow-up.
- **Check-Ins** (children's ministry security) — manage drop-off + pickup tags + emergency alerts.
- **Event registration** — VBS, retreats, conferences with capacity limits + paid registration.
- **Year-end giving statements** — tax-deductible contribution receipts (IRS-required for >$250 single gifts).
- **Member lifecycle** — visitor → regular attender → member → leader pipeline.

## Authentication

Planning Center uses **OAuth 2.0** with broad scopes per Planning Center app (People, Services, Giving, etc.):

```
Authorization: Bearer <planning-center-access-token>
```

Standard authorization-code flow with refresh tokens. Each app has its own API at:

```
https://api.planningcenteronline.com/{app}/v2/
```

Apps: `people`, `services`, `giving`, `groups`, `calendar`, `check-ins`, `registrations`, `publishing`.

**Personal Access Tokens** (PAT) also supported for single-organization integrations — useful when the customer just wants to connect their own church without going through full OAuth.

## Regulatory + ethical framing

Church-related data carries specific sensitivities:

- **Donor confidentiality** — many donors prefer anonymity; the church holds confidential giving records that should never be shared externally without explicit consent. Even staff outside the giving team typically don't see individual giving amounts (clergy may, depending on church policy).
- **Tax-receipt compliance** — IRS Pub 1771 requires annual contribution statements for donors with single gifts of $250+; written acknowledgment required for donations of $250+ to qualify for tax deduction. AutoFlow can automate, but the church's CFO/treasurer must approve the format + accuracy.
- **Children's ministry safety** — check-in/pickup tags are a security gate; never automate around them. Background-check tracking for children's volunteers is critical.
- **Pastoral care confidentiality** — pastoral conversations + counseling are typically considered privileged. Notes on care records should not be routed to non-pastoral surfaces.
- **501(c)(3) compliance** — the church is a tax-exempt nonprofit; some activities (political endorsement, certain business activities) jeopardize that status. AutoFlow routines must not enable behavior that risks the exemption.

## Core entity model (cross-app)

Planning Center's data model centers on **People** with relationships to records in each app:

| Entity | App | What it is |
|---|---|---|
| Person | People | The central record (member, attendee, donor) |
| Household | People | Family grouping |
| Field Data | People | Custom attributes (membership status, baptism date, etc.) |
| Workflow | People | Pipelines for follow-up sequences |
| Service Type | Services | A service template (Sunday morning, midweek, etc.) |
| Plan | Services | A specific weekend's plan (songs, talks, team) |
| Team / Position | Services | Volunteer team + role assignments |
| Donation | Giving | A single gift |
| Recurring Donation | Giving | A scheduled recurring gift |
| Fund | Giving | A designation (General, Missions, Building) |
| Group | Groups | A small group, ministry, or class |
| Event | Calendar | A scheduled event |
| Check-In Event | Check-Ins | A check-in instance (Sunday kids' service) |
| Registration | Registrations | A paid or capacity-limited signup |
| Pledge | Giving | A future-giving commitment |

## Common AutoFlow workflows

### 1. New-visitor follow-up sequence

```
Webhook on Person.workflow.added (added to "First-Time Visitor" workflow) →
Routine fires →
  1. Email via SendGrid: pastor's personal-style welcome + service times
  2. Schedule cron 3d after: 
       SMS: "Loved meeting you Sunday! Any questions we can answer?"
  3. Schedule cron 7d after:
       If no further visits in attendance records: SMS with a low-pressure
       invitation back
       If second visit detected: skip to second-visit sequence
  4. Schedule cron 30d after:
       Pastor/staff personal phone-call task in the workflow.
  5. Track visitor → regular attender conversion rate.
```

### 2. Recurring giving lapse outreach

```
Cron routine weekly →
  1. Query recurring donations where status changed to "Failed" or
     "Canceled" in the last 7 days
  2. For each:
       Look up the donor's giving history + any other involvement
       (group member, volunteer, etc.) for context
       Generate a thoughtful outreach routine — NOT a hard-sell email
       (a recurring-giving lapse can mean financial hardship, life
        change, or just a card expiration; care + curiosity, not pressure)
       Route to pastor or stewardship staff for personal outreach
  3. After 30d if no engagement: light SMS — "Just want to make sure
     things are okay" (relational, not transactional)
  4. NEVER include the dollar amount in outbound messages. Don't
     guilt-trip donors.
```

### 3. Volunteer scheduling + confirmations

```
Cron routine Tuesday of service week →
  1. Pull Sunday's plan from Services app
  2. For each Position with an assigned volunteer:
       SMS/email confirmation request: "Hi {first}, you're scheduled
       for {team} this Sunday at {time}. Reply C to confirm, D to decline."
  3. On D reply: open gap-filling routine — pull next eligible volunteer
                 by rotation + availability; SMS them the open slot
  4. Thursday: chase non-respondents
  5. Saturday: final reminder to confirmed volunteers
  6. Sunday morning: SMS to confirmed: "Today's the day! Doors at {time}."
```

### 4. Group attendance follow-up

```
Cron routine after group meeting times (Monday morning, etc.) →
  1. For each Group, query attendance for the most recent meeting
  2. For members absent 3+ consecutive meetings:
       Surface to the Group leader's inbox: "{name} has missed the last
        3 meetings. Want to reach out?"
       (NOT auto-email the absent member — pastoral touch matters)
  3. Group leader takes personal action.
  4. Track group health metrics (% attendance, members retained YoY).
```

### 5. Year-end giving statements

```
Cron routine on January 5 →
  1. For each donor with total giving > $0 in prior tax year:
       Generate the contribution statement per IRS Pub 1771 format:
         - Donor name + address
         - Each gift: date, amount, fund, payment method
         - Total
         - "No goods or services were provided in exchange for these
            contributions" disclaimer (or itemize if any were provided)
  2. Surface ALL statements to the church CFO/treasurer for review
     BEFORE distribution (errors in tax docs cause real problems)
  3. After CFO approval: email each donor their statement via SendGrid
     with a PDF attachment
  4. Provide a paper-mail fallback for donors without email
  5. Track receipt confirmations + handle questions.
```

### 6. Check-In safety routine (children's ministry)

```
Continuous routine during service times →
  1. Check-Ins app handles core pickup-tag security natively
  2. AutoFlow augments with:
       Allergy + medical alert surfacing — if a child with a peanut
       allergy is checked in, visible to room volunteers automatically
       Emergency contact verification — if a parent's contact info
       changes, re-verify before next check-in
       Background-check expiration alert — if a volunteer's check is
       expiring, restrict access until renewed (state-law-driven)
  3. NEVER bypass check-in security tags — that's the fundamental
     child-safety guarantee.
```

### 7. Event registration management

```
Webhook on Registration created → Routine fires →
  1. Send confirmation email via SendGrid:
       Event details, location, what to bring, contact for questions
  2. If event has paid registration:
       Confirm Stripe payment captured
       On payment failure: SMS donor to update payment
  3. Schedule cron pre-event:
       7d out: "Looking forward to seeing you at {event}!"
       1d out: logistics reminder
  4. Post-event: thank-you email + follow-up routine
                 (e.g. retreat attendees → small-group invitation).
```

## Idempotency

Planning Center's API supports idempotency keys on giving + registration writes. For routine-driven writes, dedupe by Planning Center's natural IDs.

For People upserts, dedupe by email primary then name+phone.

## Webhooks

Planning Center publishes webhooks per app:
- People: workflow changes, person creation
- Giving: donation completed, recurring donation status change
- Services: plan published, plan changed
- Check-Ins: check-in events
- Registrations: registration created/canceled

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

## Rate limits

Planning Center publishes per-app rate limits — typically conservative. 429 with `Retry-After`. Heavy reports (year-end statements, annual member directories) off-peak.

## What this skill does NOT cover

- **Sermon production / live streaming** — separate tools (Boxcast, Resi); Planning Center connects to some.
- **Worship leading / song licensing** — handled in CCLI; Planning Center references but doesn't manage rights.
- **Building management** — facility scheduling is in Calendar app; deeper facility-management (HVAC, lighting) is separate.
- **Pastoral counseling notes** — privileged; never route to non-pastoral surfaces.
- **Political activity** — anything that risks 501(c)(3) status is out of scope; AutoFlow routines must not enable.
- **Direct evangelism / unsolicited outreach** — many states' do-not-call rules apply; default to opted-in lists only.

## References

- API: https://developer.planning.center/docs/
- IRS Pub 1771 (contribution acknowledgments): https://www.irs.gov/pub/irs-pdf/p1771.pdf
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-app scopes; pastoral-confidentiality + tax-receipt-review guardrails)
