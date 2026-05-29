---
name: bloomerang
description: Use this skill when an AutoFlow agent needs to read or write data in Bloomerang — the donor + constituent relationship management platform for small-to-mid nonprofits (501(c)(3) charities, advocacy orgs, community foundations, animal-welfare, arts orgs, social-service agencies). Pull constituents / interactions / transactions / appeals / campaigns, react to donation and engagement events, push gifts to QuickBooks Nonprofit, run year-end + monthly tax-receipt routines, automate moves-management workflows for major-donor cultivation. Covers Bloomerang's REST API + API-key auth, the Constituent / Interaction / Transaction / Campaign / Appeal / Fund / Solicitor model, nonprofit-specific compliance (IRS Form 990, donor confidentiality, quid pro quo disclosure), and the workflow shape AutoFlow customers reach for (acknowledgment letters, retention outreach, major-donor moves management, monthly giving lapse recovery).
---

# Bloomerang — small-nonprofit donor + constituent management

Bloomerang is the leading donor-management platform for AutoFlow's small-to-mid nonprofit SMBs — 501(c)(3) charities, advocacy organizations, community foundations, animal-welfare orgs, arts + culture orgs, social-service agencies, conservation/environmental groups. ~12,000 nonprofits use it; competes with DonorPerfect, Neon CRM, Little Green Light, and Salesforce NPSP at the small/mid end.

Use Bloomerang when the customer is a **non-religious nonprofit** running fundraising + donor relationship management. For churches → Planning Center. For very large nonprofits (~$50M+ revenue) → Salesforce NPSP / Raiser's Edge NXT. For totally tiny orgs (under ~$100K budget) → spreadsheets or Little Green Light.

## When to reach for this skill

- **Donation received** → acknowledgment letter generation, tax-receipt routine, QBO entry, retention pipeline assignment.
- **Major donor moves management** — track cultivation steps from prospect → cultivated → solicited → stewarded.
- **Monthly recurring giving** — lapse recovery routine when card declines or donor cancels.
- **Year-end giving statements** — IRS-compliant annual contribution summaries.
- **Appeal campaign tracking** — performance reporting per appeal/campaign.
- **Retention rate routine** — donor retention is the #1 nonprofit health metric; sweep for lapsed donors + fire stewardship outreach.
- **Volunteer + program participation** — Bloomerang tracks broader constituent engagement, not just gifts.
- **Event registration + sponsorship** — galas, walks, golf tournaments.

## Authentication

Bloomerang uses **API key authentication**:

```
X-API-KEY: <bloomerang-api-key>
```

Keys are issued in the nonprofit's account settings. AutoFlow stores in the secrets store; one key per Bloomerang database (each nonprofit = one DB).

Base URL: `https://api.bloomerang.co/v2/`

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Constituent | Any person/org in the database (donor, volunteer, board member, prospect, board member, recipient) | Central record |
| Household | A grouping (family unit) | Useful for joint gifts + dual-receipt |
| Relationship | A link between constituents | Spouse, employer, board affiliation |
| Transaction | A financial transaction | Donations + pledges + soft credits |
| Interaction | A non-financial touchpoint | Email, call, meeting, event attendance |
| Communication | A logged outbound communication | Acknowledgment letters, newsletters |
| Note | Free-text record | Stewardship history, prospect research |
| Tribute | An in-honor/in-memory designation | Drives notify-honoree workflow |
| Pledge | A future giving commitment | With installment schedule |
| Recurring Donation | A scheduled recurring gift | Source of monthly-giving program |
| Campaign | A fundraising effort | "Annual Fund 2026" |
| Appeal | A specific solicitation within a campaign | "Spring Direct Mail" |
| Fund | A designation (Operating, Endowment, Building) | Determines accounting category |
| Solicitor | Staff/volunteer credited with bringing a gift | For moves management |

## Common AutoFlow workflows

### 1. Donation acknowledgment + receipt

```
Webhook on transaction.created (where type=donation) → Routine fires →
  1. Get the constituent + transaction details
  2. Generate the acknowledgment letter via the workspace's template:
       - Personalized salutation (Constituent.PreferredSalutation or fallback)
       - Gift amount, date, fund, campaign
       - Quid pro quo disclosure if event-related (IRS Pub 1771 requires
         disclosure when the donor received goods/services in exchange)
       - "No goods or services were provided" statement otherwise
       - Tax-deductible disclaimer
       - 501(c)(3) EIN
  3. Surface to ED/staff for review if over a workspace threshold
     (e.g. all gifts $5,000+ get personal review before sending)
  4. Email via SendGrid (with PDF) for digital-preference donors
  5. Generate a print queue for postal-preference donors
  6. Log the acknowledgment as a Communication in Bloomerang for
     audit trail.
```

### 2. Year-end giving statements

```
Cron routine on January 5 →
  1. For each constituent with total giving in prior tax year > $0:
       Generate the annual contribution statement per IRS Pub 1771:
         - All gifts itemized with dates + amounts + funds
         - Sum totals
         - Quid pro quo amounts noted where applicable
         - Standard "no goods or services" disclaimer where applicable
         - Org's EIN + 501(c)(3) verification
  2. ALL statements surface to the ED/CFO for review before
     distribution (errors in tax docs are real problems)
  3. After approval: SendGrid for digital, print queue for postal
  4. Track receipt delivery + handle donor questions.
```

### 3. Major-donor moves management

```
Cron routine weekly →
  1. Query constituents with major-donor flag (workspace-configurable —
     typically $1,000+ cumulative, $250+ single gift, or by capacity
     score)
  2. For each, check last interaction date + current move-stage:
       Prospect → cultivated: needs first meaningful interaction in 90d
       Cultivated → solicited: needs ask in 6mo (with PRC plan)
       Solicited → stewarded: needs follow-up interaction in 30d after
                              ask + thank-you in 7d after gift
       Stewarded → cultivated: ongoing touch every 60-90d
  3. If a constituent is behind their move-stage cadence:
       Slack alert to the assigned solicitor with the next-action
       suggestion
       Surface in the major-donor portfolio dashboard
  4. Major-donor cultivation is high-touch + relational; AutoFlow
     surfaces signals, the staff person decides + acts.
```

### 4. Monthly recurring lapse recovery

```
Webhook on recurring_donation.failed OR daily scan for canceled-status →
Routine fires →
  1. Look up donor giving history + engagement context
  2. If card decline (transient):
       Email/SMS: "Your monthly gift didn't process. Update your card
                   in the donor portal: {link}"
       Schedule retry routine (3 attempts over 14 days)
  3. If donor-initiated cancel:
       Send a thoughtful retention email (NOT a save-the-gift
       desperation message — donors often cancel for life-circumstance
       reasons; respect that)
       Surface to development staff for a personal phone call
       60d later: send a re-engagement email
  4. Never use guilt or pressure; nonprofit donor relationships are
     long-term.
```

### 5. Donor retention sweep

```
Cron routine monthly →
  1. Compute retention metrics:
       new_donor_retention = % of last_year_first_time_donors who gave again
       recurring_retention = % of last_year_recurring_donors still giving
       overall_retention = % of last_year_total_donors who gave again
  2. Identify lapsed donors (gave in prior year, no gift in current
     year) past their typical giving cadence:
       For repeat donors (3+ gifts): assign to staff for re-engagement
       For one-time donors: assign to mass-appeal next-mailing
  3. Report quarterly retention to ED + board.
  4. Retention is the #1 nonprofit health metric (Donor Retention
     Project benchmark ~45% industry average); a 1% improvement in
     retention is worth ~5% in fundraising revenue.
```

### 6. Appeal campaign performance

```
Triggered after a fundraising appeal sends → Cron routine weekly →
  1. Pull all gifts attributed to the appeal (via source code or appeal
     field)
  2. Compute:
       gross revenue, cost (mail + design + staff time), net,
       response_rate (donors who gave / total appeals sent),
       average_gift, # donors acquired vs returning
  3. Compare against the appeal budget + historical benchmark
  4. Email report to ED + development team
  5. Roll into the campaign's overall performance for board reporting.
```

### 7. Event registration + sponsorship

```
Event registration webhook (gala, walk, golf, etc.) → Routine fires →
  1. Confirmation email with event details
  2. If sponsorship (over a threshold):
       Generate sponsorship contract via DocuSign
       Trigger benefits delivery (logo on signage, table reservations,
       etc.) via tasks to event staff
  3. Pre-event reminders + day-of logistics
  4. Post-event: thank-you + tax receipt (per IRS Pub 1771 — fair
                  market value of dinner/golf etc. is NOT deductible;
                  only excess is)
       This is the most common tax-receipt error in nonprofits.
       Surface to CFO for review.
```

## Nonprofit-specific compliance

- **IRS Pub 1771** governs acknowledgment letters; donations $250+ require written acknowledgment for tax-deductibility. Quid pro quo (donor received goods/services in exchange) must disclose fair-market-value of benefits received; only excess is deductible.
- **Form 990** (annual nonprofit tax return) requires transactions reported in specific buckets; the chart of accounts in QBO Nonprofit must align with 990 categories.
- **Donor-Advised Fund (DAF) gifts** — increasingly common; these come from the donor's DAF sponsor (Fidelity Charitable, Vanguard Charitable). The soft credit goes to the individual but the legal donor is the DAF; acknowledge appropriately (no tax receipt; the DAF already took the deduction).
- **Restricted vs unrestricted gifts** — donor designations bind the org legally; using restricted gifts for other purposes is fraud. Fund tracking matters.
- **Donor confidentiality** — never share donor lists externally without explicit consent; anonymity preferences must be honored on donor walls + reports.
- **State charitable solicitation registration** — orgs soliciting in multiple states need registration in each (varies wildly); AutoFlow doesn't enforce but agents should be aware.

## Idempotency

Bloomerang's API supports some idempotency on transaction writes. For routine-driven writes (interactions, notes, communications), dedupe by (constituent_id, timestamp, type).

## Webhooks

Bloomerang publishes webhooks for major events:
- `transaction.created`, `transaction.updated`
- `constituent.created`, `constituent.updated`
- `interaction.created`
- `recurring_donation.failed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Bloomerang publishes per-account rate limits. Typically conservative; 429 with `Retry-After`. Heavy reports (annual giving statements, retention sweeps) off-peak.

## What this skill does NOT cover

- **Grant management** (Foundant, Submittable) — separate tools for grant-application + grantmaking.
- **Peer-to-peer fundraising platforms** (Classy, Give Lively) — integrated via webhooks; gifts flow into Bloomerang as transactions.
- **Volunteer management at scale** (VolunteerMatch, Givepulse) — Bloomerang has basic; serious volunteer ops use specialty tools.
- **Endowment investment management** — separate accounting + fiduciary tooling.
- **Lobbying / advocacy compliance** — political-spending limits for 501(c)(3) and (c)(4); legally complex, not AutoFlow's to manage.

## References

- API: https://bloomerang.co/api/
- IRS Pub 1771: https://www.irs.gov/pub/irs-pdf/p1771.pdf
- IRS Form 990: https://www.irs.gov/forms-pubs/about-form-990
- Donor Retention Project: https://afpglobal.org/fundraising-effectiveness-project
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; tax-receipt review-gate before send; DAF and restricted-gift discipline)
