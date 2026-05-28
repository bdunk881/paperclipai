---
name: dotloop
description: Use this skill when an AutoFlow agent needs to read or write data in dotloop — the transaction-management platform for residential real estate brokerages, teams, and agents. Pull loops (transactions) / participants / documents / tasks, react to loop status changes, push closing data to QuickBooks for commission reconciliation, manage compliance-document deadlines, fire commission-split routines, or sync transaction milestones to CRM. Covers dotloop's OAuth 2 auth, the Profile / Loop / Participant / Document / Task / Folder model, real-estate-specific compliance discipline (broker compliance, escrow, license), and the workflow shape AutoFlow customers reach for (under contract → compliance checklist, closing → commission split + brokerage QBO entry, expiring docs → agent reminder).
---

# dotloop — residential real estate transaction management

dotloop is the dominant transaction-management platform for AutoFlow's residential-real-estate SMBs — independent brokerages, real-estate teams, individual high-volume agents, transaction coordinators. It owns the compliance-document workflow that residential transactions require: listing agreements, offers, counter-offers, addenda, disclosures, closing docs.

Use dotloop when the customer **closes residential real estate transactions** and needs the brokerage's compliance trail. For commercial real estate → dealcloud or AppFolio. For property management (ongoing tenant ops) → AppFolio or Buildium.

## When to reach for this skill

- **Loop status changes** (Pre-Listing → Listed → Under Contract → Closed → Archived) → fire routine to update CRM, notify compliance, calculate commission.
- **Document added / signed** → log to compliance audit trail, check for missing required docs against the brokerage's template.
- **Task assigned / completed / overdue** → reminder routine to the agent or coordinator.
- **Closing reached** → push to QuickBooks as a brokerage receivable + commission split, fire celebration routine (Mailchimp testimonial-request email, Slack alert to the team).
- **Expiring document** (e.g. listing agreement near expiration) → 30-day-out agent reminder routine.
- **New buyer/seller participant added** → upsert to HubSpot for ongoing CRM relationship.

## Authentication

dotloop uses **OAuth 2.0** with refresh tokens:

```
Authorization: Bearer <dotloop-access-token>
```

Standard authorization-code flow. Access tokens last 1 hour; refresh tokens are long-lived but rotate on use.

Base URL: `https://api-gateway.dotloop.com/public/v2/`

Auth model: the OAuth grant is per **dotloop user** (an agent or coordinator). For team integrations where AutoFlow operates on behalf of multiple agents, each agent's individual grant is required. For brokerage-level integrations, the dotloop admin user's grant covers all visible loops.

## Core entity model

dotloop's data model maps directly to residential transaction stages:

| Entity | What it is | Position in workflow |
|---|---|---|
| Profile | A dotloop user account (agent, coordinator, broker) | The actor |
| Loop | A single transaction (a property's deal lifecycle) | Central organizing unit |
| Folder | A categorized container of documents within a loop | Listing, Offers, Compliance, etc. |
| Document | A file within a folder (PDF, contract, disclosure) | The artifacts |
| Participant | A person involved in the loop (buyer, seller, agent, lender, title) | Who is doing what |
| Task | A checklist item per loop | Compliance tracking |
| Activity | An event log entry per loop | Audit trail |

## Common AutoFlow workflows

### 1. Loop status → Under Contract → compliance routine

```
dotloop webhook on loop.statusChanged (status="Under Contract") → Routine fires →
  1. GET /loops/{loop_id} for property + participants + close date
  2. Compare loop.folders → required docs against brokerage's
     compliance template (workspace-configurable list per transaction type)
  3. POST a Slack alert to the agent + coordinator with the gap list:
       "Missing: Lead-Based Paint Disclosure, Property Disclosure"
  4. Schedule cron at close_date - 7 days: re-check completion
       Escalate to broker if still missing.
  5. POST HubSpot timeline event on the buyer + seller contacts.
```

### 2. Closing → commission split + brokerage QBO entry

```
dotloop webhook on loop.statusChanged (status="Closed") → Routine fires →
  1. GET /loops/{loop_id} for purchase_price + commission_rate + participants
  2. Calculate splits per the brokerage's rules:
       gross_commission = purchase_price * commission_rate
       brokerage_split  = gross_commission * (1 - agent_split_pct)
       agent_gross      = gross_commission * agent_split_pct
       agent_net        = agent_gross - desk_fees - errors_and_omissions_share
  3. POST QBO /invoice to the closing co. / settlement agent for brokerage_split
  4. POST QBO /vendorbill (or 1099 expense entry) for agent_net to be paid out
  5. SMS the agent via Twilio: "🏠 Closing recorded. Commission $X net X.
                                Expected pay-out date: {next payroll}."
  6. Fire testimonial-request routine through Mailchimp/Klaviyo to the
     buyer + seller contacts after close+7d.
```

### 3. Expiring listing → agent reminder

```
Cron routine daily →
  1. GET /loops?status=Listed (paginate)
  2. For each loop, check the Listing Agreement document's expiration_date
     (a property metafield)
  3. If expiration_date within 30 days:
       Add a Task to the loop: "Renew listing agreement (expires {date})"
       SMS the listing agent
       Tag in HubSpot for nurture sequence ("listing-renewal-due")
  4. If within 7 days and no Task action yet:
       Escalate to brokerage admin
```

### 4. Document signed → compliance audit trail

```
dotloop webhook on document.signed → Routine fires →
  1. GET /documents/{document_id} for signers + signed_at + loop_id
  2. Append to the workspace's BAA/compliance audit table:
       (loop_id, document_name, document_id, signers[], signed_at, hash)
  3. Cross-check against the brokerage compliance template:
       If this completes a required doc set, mark the loop as
       "compliance-clear" in HubSpot
  4. Optional: post a Slack confirmation to #compliance-watch.
```

### 5. New participant → CRM upsert

```
dotloop webhook on participant.added → Routine fires →
  1. GET /participants/{id} for email + phone + role + loop reference
  2. HubSpot PUT /crm/v3/objects/contacts/{email}?idProperty=email
       properties: {
         firstname, lastname, email, phone,
         dotloop_loop_id: loop.id,
         participant_role: role  // "Buyer", "Seller", "Lender", etc.
       }
       set lifecyclestage based on role:
         Buyer / Seller → opportunity
         Agent (other side) → industry_contact
  3. Optionally enroll in role-appropriate Mailchimp nurture
     (buyers get post-close ownership tips, sellers get listing-prep).
```

## Idempotency

dotloop does not expose an idempotency-key header. For routine-driven writes:
- For Task creation: query existing loop tasks first; match by title + due-date
- For Activity log entries: dotloop deduplicates internally by user + action + timestamp + 1-minute window
- For Document upload: check loop.folders for existing documents matching the file name + folder + size

## Webhooks

Subscribe via the API (partner-program API key required):

```
POST /webhooks
body:
  url: "https://autoflow.example/webhooks/dotloop/{workspace_id}"
  events: ["LOOP_STATUS_CHANGED", "DOCUMENT_SIGNED", "PARTICIPANT_ADDED", "TASK_COMPLETED"]
```

Signature verification: webhook payloads carry `X-DotLoop-Signature` (HMAC-SHA256 of body with the per-subscription secret). **Verify before processing**.

Replay safety: events have stable `eventId`; dedupe.

## Real-estate compliance discipline

Real estate transactions are subject to **brokerage compliance, RESPA, state-specific disclosure rules, and licensing requirements**. AutoFlow routines must respect:

- **Required documents** are state-specific (TX vs CA vs NY all differ) — compliance templates must be configurable per brokerage / per state.
- **Earnest money + escrow** flows through the title company, not dotloop. AutoFlow can read closing milestones but must never represent earnest funds movement as completed without confirmation.
- **License status** — agents whose license has expired cannot legally close transactions. If a brokerage shares license-renewal dates, surface upcoming expirations as a routine before they impact a closing.
- **Audit trail integrity** — dotloop's activity log is the broker's compliance record. AutoFlow can append annotations (via Tasks) but must never alter, delete, or obscure the activity log.

## Rate limits

- **600 requests/hour** per access token (default; may be raised for partner integrations).
- 429 returns standard `Retry-After`.
- For brokerage-wide loop sweeps, use `?modifiedSince=...` for incremental sync rather than full re-pulls.

## What this skill does NOT cover

- **MLS data** (active listings, comparables) — separate APIs per region (CRMLS, BrightMLS, etc.); not exposed via dotloop.
- **Lead generation** — Zillow/Realtor.com/etc. webhook into HubSpot, not dotloop.
- **Showing scheduling** — typically ShowingTime or Calendly; AutoFlow integrates with those separately.
- **Title / closing software** — Qualia, ResWare, SoftPro; the title co.'s system, not the brokerage's.

## References

- API: https://dotloop.github.io/public-api/
- OAuth: https://dotloop.github.io/public-api/#authentication
- Webhooks: https://dotloop.github.io/public-api/#webhooks
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; one grant per dotloop user; brokerage admin grant for team-wide visibility)
