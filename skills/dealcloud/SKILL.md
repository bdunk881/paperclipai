---
name: dealcloud
description: Use this skill when an AutoFlow agent needs to read or write data in DealCloud (an Intapp product) — the deal-management + CRM platform for commercial real estate brokerages, investment banks, private equity, asset management, and professional-services firms running deal pipelines. Pull deals / contacts / firms / properties / activities, react to deal-stage changes, push pipeline metrics to dashboards, automate research + outreach routines, manage relationship intelligence, and run capital-markets workflow automation. Covers DealCloud's REST API + token auth, the Deal / Contact / Firm / Property / Activity / Document model, capital-markets compliance considerations (MNPI, restricted lists, conflict-of-interest checks, broker-dealer KYC/AML), and the workflow shape AutoFlow customers reach for (deal-pipeline reporting, relationship-intelligence routines, capital-markets activity logging, NDA + closing workflow).
---

# DealCloud — capital markets + CRE deal management

DealCloud (acquired by Intapp in 2018) is the leading deal + relationship management platform for AutoFlow's capital-markets + professional-services SMBs — commercial real estate brokerages, investment banks (M&A advisory, sell-side, buy-side), private-equity firms, hedge funds, asset managers, law firms with M&A practices, real-estate investment trusts (REITs), family offices, business brokers. Used by 1,000+ firms with concentrated penetration in mid-market PE + boutique investment banks.

Use DealCloud when the customer is a **deal-pipeline-driven professional-services firm** managing relationships + opportunities across many investors/buyers/sellers/counterparties. For commercial real estate transactions (broker-dealer side) → DealCloud; for residential transactions → dotloop. For SaaS CRM-only → HubSpot.

## When to reach for this skill

- **Deal-pipeline reporting** — weekly/monthly stage summaries by team, sector, deal type.
- **Relationship intelligence** — who-knows-who lookups, last-touched-date sweeps for partner attention.
- **Capital-markets activity logging** — track all touchpoints (emails, calls, meetings) for compliance + relationship management.
- **NDA workflow** — many deals require NDA before sharing financials; standard pre-deal pattern.
- **Closing workflow** — pre-closing checklists, closing-day coordination, post-closing follow-up.
- **Sector / mandate matching** — when a new deal lands, match against firm's investor mandates (PE: "buyer looking for HVAC services $5-20M EBITDA in Southeast US").
- **Pitch + win-rate analysis** — what wins us deals; track close ratios by sector + senior banker.

## Authentication

DealCloud uses **API key + token-based authentication** (per Intapp's standard pattern):

```
Authorization: Bearer <dealcloud-access-token>
```

Tokens are issued per integration partner. AutoFlow stores in secrets store.

Base URL: `https://api.dealcloud.com/api/rest/v1/` (per tenant; verify per current Intapp docs at integration time)

Tenant-scoped: each firm is its own DealCloud tenant. AutoFlow connections pin per-tenant.

## Core entity model

DealCloud's data model is heavily customizable per firm — these are the canonical entities most installations have:

| Entity | What it is | Notes |
|---|---|---|
| Deal | An opportunity / transaction | Central organizing unit; stage-tracked |
| Contact | A person (banker, investor, executive, counterparty) | Detailed profile |
| Firm | A company (sponsor, target, buyer, broker) | Detailed profile |
| Relationship | Link between contacts (board, prior employer, college) | Powers relationship intelligence |
| Property | A real estate asset (for CRE customers) | With financials + comps |
| Activity | An interaction (email, call, meeting, materials sent) | Logged for compliance |
| Document | Pitch deck, CIM, NDA, term sheet | Attached to deals + tracked |
| Task | An assigned action item | Workflow primitive |
| Stage | Pipeline position (Origination → Diligence → IC → Close) | Custom per firm |
| Mandate | Investor's stated criteria | For deal-to-mandate matching |
| Investor / LP | Limited partner relationships | For PE customers |

## Common AutoFlow workflows

### 1. Deal-pipeline weekly report

```
Cron routine Monday 6am →
  1. Pull all deals at each stage as of week-end
  2. Compute deltas vs prior week:
       New originations, advanced, closed-won, closed-lost
       Stage-conversion rates
       Average deal size by stage
  3. Generate the pipeline report (PDF or Slack-formatted)
  4. Distribute to MD / Partner / Senior team:
       Email + Slack
       Highlight stalled deals (>X days in same stage)
       Highlight stage transitions for celebration or attention
  5. Track pipeline-health metrics over time.
```

### 2. Last-touched-date relationship sweep

```
Cron routine weekly →
  1. For each Contact tagged as "priority relationship" (e.g. C-suite,
     board members, key LPs, repeat sellers):
       Compute days since last logged Activity
       If > workspace threshold (typically 90d for VIPs, 180d for
       regular relationships):
         Add to senior banker's outreach queue
         Suggest a touch-base topic from recent firm news / their
         portfolio company activity
  2. Surface to the assigned banker in Slack or email
  3. Track touch-rate compliance (% VIPs touched in last quarter).
  4. Relationship freshness is the moat for boutique investment banks
     + small PE firms — automation that surfaces decay is high-leverage.
```

### 3. Capital-markets activity logging

```
Webhook on email_sent OR meeting_completed (via Outlook/Gmail integration) →
Routine fires →
  1. Identify the deal/contact/firm the activity relates to
     (subject parsing, recipient matching, or banker manual tag)
  2. POST Activity to DealCloud:
       type: email / call / meeting
       deal_id, contact_id, firm_id (where applicable)
       timestamp, banker_id
       subject + summary (NOT full email body for compliance reasons —
                          only metadata + summary)
  3. For meetings: prompt the banker for a follow-up note within 24h
  4. Compliance angle: regulated firms (broker-dealers, RIAs) must
     log certain activities under FINRA / SEC books-and-records rules.
     Don't auto-log if the firm hasn't configured the compliance scope.
```

### 4. NDA workflow

```
Triggered when a deal advances to a stage requiring NDA →
  1. Identify which party needs to sign (buyer, potential investor)
  2. Generate the NDA via DocuSign template (deal-type specific)
  3. Send for signature
  4. On signature complete:
       Attach signed NDA to the deal in DealCloud as a Document
       Update deal record: NDA signed = true + date
       Notify deal team that financial materials can now be shared
  5. Track NDA-to-financials-shared time (deal velocity metric).
```

### 5. Sector / mandate matching for PE firms

```
Webhook on deal.created OR daily routine →
  1. Pull new origination deals
  2. For each, extract deal characteristics:
       sector, sub-sector, geography, deal size range, EBITDA,
       deal type (control vs minority, buyout vs growth, etc.)
  3. Match against investor mandates in the firm's database:
       For each match: surface as a likely buyer
       Score by historical investment pattern + recent activity
  4. Suggest 5-10 likely buyers/investors to the deal team
  5. Track match-to-pitch + pitch-to-win conversion.
  6. For PE customers, also match against their own portfolio
     mandate (current funds + thesis).
```

### 6. Closing workflow + checklist

```
Triggered when deal advances to "Closing" stage →
  1. Generate the closing checklist from deal-type template:
       LP capital calls (PE)
       Wire instructions confirmed
       Closing documents signed via DocuSign
       Funds flow finalized
       Press release drafted (if announcement-stage)
       Regulatory filings prepared (HSR, ABA, etc.)
  2. Surface each task to responsible team member with deadline
  3. Track closing-day readiness; alert on missed items
  4. On Close: trigger post-close routines:
       Welcome packet to portco
       Public announcement (per agreed plan)
       Internal kickoff (PE: 100-day plan; bank: close fee revenue)
       Comms to investors (LPs, etc.)
```

### 7. Pitch + win-rate analysis

```
Cron routine monthly →
  1. Pull all pitches (deals where firm pitched but didn't win) + wins
     for the trailing 12 months
  2. Compute:
       Win rate by sector
       Win rate by deal size
       Win rate by senior banker
       Win rate by intro source (warm referral vs cold)
  3. Identify patterns:
       Strongest sectors, weakest sectors
       MD-level performance
       Source ROI (referral networks pay off vs cold)
  4. Quarterly report to firm leadership.
```

## Capital-markets compliance — the regulated layer

Many DealCloud customers are regulated entities subject to FINRA / SEC / state-securities rules. AutoFlow routines must respect:

- **MNPI (Material Non-Public Information)** — bankers + advisors handle confidential information that's price-sensitive. Routines must NEVER aggregate or surface MNPI outside need-to-know channels. AutoFlow logs must be access-controlled accordingly.
- **Restricted lists** — when a deal is active, the firm may restrict trading + communications about the target. AutoFlow routines must respect restricted-list flags on Deals + Firms.
- **Conflict-of-interest (COI) checks** — before engaging on a deal, firm checks if the firm/partners have a conflicting position. AutoFlow can surface signals (other deals involving same parties) but the COI decision is a human one.
- **Books-and-records (Rule 17a-3, 17a-4)** — broker-dealers must retain certain communications for 3-7 years; advisors have similar Investment Advisers Act rules. AutoFlow's activity-logging must align with the firm's compliance scope.
- **KYC + AML** — broker-dealers must verify counterparty identity; not auto-completable without compliance staff involvement.
- **Private fund offerings (Reg D)** — investor accreditation, suitability, and qualified-purchaser checks needed before sharing fund materials.

## Idempotency

DealCloud's API supports idempotency on writes. For routine-driven creates (activities, tasks, deals), use deterministic keys.

For contact + firm upserts, dedupe by email + firm name + role before creating.

## Webhooks

DealCloud / Intapp publishes webhooks for major events:
- `deal.created`, `deal.stage_changed`
- `contact.created`, `contact.updated`
- `firm.created`
- `activity.logged`
- `document.uploaded`
- `task.created`, `task.completed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

DealCloud / Intapp publishes per-tenant rate limits. Typically conservative for periodic reporting; 429 with `Retry-After`. Heavy pipeline reports off-peak.

## What this skill does NOT cover

- **Compliance archiving infrastructure** (Smarsh, Global Relay) — separate retention products firms use alongside DealCloud.
- **Order management systems** (Bloomberg AIM, Charles River) — trading workflow; separate from deal pipeline.
- **Portfolio company management** (Affinity, Vencast) — some PE firms layer separate tools post-close.
- **Public company investor relations** — separate IR tools.
- **Fund administration** (SS&C, NAV calc) — separate platforms.

## References

- API: https://www.intapp.com/products/dealcloud/ (per partner agreement)
- FINRA rules: https://www.finra.org/rules-guidance/rulebooks/finra-rules
- SEC Investment Advisers Act: https://www.sec.gov/about/laws/iaa40.pdf
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-tenant credentials; MNPI + restricted-list awareness on all surfacing routines)
