---
name: clio
description: Use this skill when an AutoFlow agent needs to read or write data in Clio Manage — the practice-management platform for small + mid law firms. Pull matters / contacts / activities / bills, fire downstream routines on matter events (intake → conflict check → engagement letter), push time entries from external sources, log communications back to a matter, generate invoices, or sync trust account ledgers to QuickBooks. Covers Clio's OAuth 2 auth, the Contact / Matter / Activity / Bill / Trust model, ethical-walls + permissions discipline, and the workflow shape AutoFlow customers reach for (intake → engagement → time-tracking → billing → trust-account reconciliation).
---

# Clio Manage — legal practice management

Clio Manage is the dominant practice-management platform for small and mid-sized law firms (1-50 lawyers) — solo practitioners, boutique firms, regional partnerships. It owns matter management (the legal equivalent of CRM-deal-plus-project), time tracking, billing, trust accounting (IOLTA), and document management.

Legal SMBs have **regulatory constraints** that change how AutoFlow integrates: ethical walls (a lawyer can't see a matter they're conflicted on), privilege (client communications are protected from discovery), and trust-account compliance (client funds in IOLTA accounts must never be commingled). Build routines with these in mind.

## When to reach for this skill

- **New client intake** → conflict check, automated engagement-letter draft via DocuSign.
- **Matter event** (status change, document added) → fire CRM / Slack / email routine.
- **Time entry from external source** (CalendlyCalendar meeting, email exchange) → log as a Clio Activity for billing.
- **Bill generated** → email to client via SendGrid with PDF attached, log to QBO as receivable.
- **Trust account deposit / withdrawal** → mirror to QBO as a separate ledger; trigger anomaly alert on threshold breach.
- **Document filed in court** → notify the matter team (Slack), update the matter's status.

## Authentication

Clio uses **OAuth 2.0** exclusively. Standard authorization-code flow:

```
Authorization: Bearer <clio-access-token>
Content-Type: application/json
```

Tokens last 1 hour; refresh tokens last indefinitely but rotate on use.

Regional bases (data residency matters in legal):
- US: `https://app.clio.com/api/v4/`
- Canada: `https://ca.app.clio.com/api/v4/`
- UK: `https://eu.app.clio.com/api/v4/`
- Australia: `https://au.app.clio.com/api/v4/`

The customer's region is determined at firm-setup time and must be captured on the AutoFlow connection record.

## Core entity model

| Entity | What it is | Legal-specific notes |
|---|---|---|
| Contact | Person or company (client, opposing party, court, vendor) | Two types: People (`Person`) + Organizations (`Company`) — different fields |
| Matter | A legal engagement (a lawsuit, a transaction, a will) | The central organizing unit — almost everything links here |
| Practice Area | Categorization (litigation, M&A, family law, etc.) | Drives billing rates + reporting |
| Activity | A time entry or expense charged to a matter | Source of billable hours |
| Bill | An invoice for activities + expenses | Trust funds may be applied to it |
| Trust Request | A request to withdraw from trust to pay a bill | Compliance-critical |
| Trust Transaction | A deposit / withdrawal in the trust ledger | Must never commingle with operating funds |
| Document | A file attached to a matter | Privileged; access-controlled |
| Communication | A logged email / phone call / meeting | Used for billing + matter timeline |
| User | Firm member (lawyer, paralegal, admin) | Ethical-wall rules apply per user |

## Common AutoFlow workflows

### 1. New intake → conflict check + engagement letter

```
Web intake form via Typeform → Routine fires →
  1. POST Clio /contacts (Person type) with name, email, phone
  2. POST Clio /matters with:
       description: "Intake from {form_id}"
       client_id: contact.id
       practice_area_id: (mapped from form's "service-needed" answer)
       status: "Pending"
  3. Conflict check (manual step or automated):
       GET /contacts/search?query={opposing_party_names}
       If any results, flag the matter as "Conflict review needed",
       Slack alert to the conflicts committee.
  4. If clear, POST DocuSign envelope from engagement-letter template,
     populated with matter + contact details (see docusign skill).
  5. On envelope-completed: PATCH matter.status = "Open" and start the
     billing clock.
```

### 2. External time tracking → Clio Activity

```
Calendly meeting completed (with client matter linked via custom field) →
Routine fires →
  1. Look up matter_id from the Calendly event's notes / metadata
  2. POST Clio /activities:
       date, duration_in_seconds, matter_id,
       activity_description_id (from matter's billing rate config),
       user_id (the lawyer who took the meeting),
       note: "Meeting: {event_title} - {summary}"
  3. The activity becomes billable on the next bill generation.
```

### 3. Bill generated → email + QBO receivable

```
Clio webhook on bill.created → Routine fires →
  1. GET /bills/{id}?include=line_items,matter,contact
  2. GET /bills/{id}/pdf for the bill PDF
  3. POST SendGrid /mail/send:
       to: matter.contact.email
       subject: "Invoice {bill.number} from {firm.name}"
       template_id: <bill-email-template>
       dynamic_template_data: { amount_due, due_date, ... }
       attachments: [bill.pdf as base64]
  4. POST QBO /invoice mirroring the Clio bill:
       customer = matched QBO customer (by email)
       line items = mapped from bill.line_items
       PrivateNote: "Clio bill {clio_bill_id}"
```

### 4. Trust account reconciliation

```
Cron routine weekly →
  1. GET /trust_transactions?from={last_run}&to={now} (paginate)
  2. For each transaction:
       Deposit  → debit Trust Bank (in QBO), credit Trust Liability
       Withdrawal → debit Trust Liability, credit Trust Bank
       Trust-to-Operating (paying a bill) → debit Trust Liability,
                                            credit Accounts Receivable
  3. POST QBO /journalentry with the lines
  4. Reconcile: sum of Trust Liability should equal sum of all matters'
     trust balances. If not, ALERT loudly (compliance violation).
  5. Slack alert if reconciliation mismatch >$0.01.
```

### 5. Document filed → matter team notification

```
Clio webhook on document.created (where document.category = "Court Filing") →
Routine fires →
  1. Get the matter team (users assigned to the matter)
  2. For each team member, post a Slack DM:
       "📁 New filing on {matter.description}: {document.name}
        Link: {clio_url}"
  3. Optionally append to a running "Filings This Week" Notion page.
```

## Idempotency

Clio does not expose an idempotency-key header. For routine-driven writes (especially Activities and Bills), use Clio's natural unique fields to dedupe:
- For Activities: `(matter_id, user_id, date, duration_in_seconds, note)` is functionally unique
- For Bills: query for existing bills on the matter for the period before creating

For Contact / Matter upserts, query by email or name + practice-area before creating.

## Webhooks

Clio webhooks are configured at the integration level via API:

```
POST /webhooks
body:
  url: "https://autoflow.example/webhooks/clio/{workspace_id}"
  topic: "matter.created"
  status: "active"
```

Signature verification: `X-Clio-Signature` is HMAC-SHA256 of body with the integration secret. **Verify before processing** — matter data is privileged.

Replay safety: webhook payloads include `event_id`; dedupe on AutoFlow side.

Common topics:
- `matter.created`, `matter.updated`
- `contact.created`
- `activity.created`
- `bill.created`, `bill.sent`, `bill.paid`
- `trust_transaction.created`
- `document.created`

## Ethical walls + permissions

Some Clio firms configure **ethical walls** — a user can be restricted from viewing certain matters (e.g. they previously represented the opposing party). The API respects these walls: queries return only matters the OAuth-authorized user can see.

AutoFlow's pattern: the OAuth grant is typically tied to the firm's **admin user** who has full visibility. Be careful when re-exposing data through AutoFlow — don't accidentally show a walled lawyer information they're not entitled to. If in doubt, scope queries to specific users.

## Trust accounting compliance

Trust accounts (IOLTA in the US) hold client funds. They must:
- Never commingle with operating funds
- Be reconciled at least monthly (bar association requirements vary by state)
- Have every transaction recorded

AutoFlow routines that touch trust data must:
- Never silently transfer trust funds (every Trust Request needs human approval)
- Mirror every trust transaction to a separate QBO bank account (not the operating bank)
- Alert immediately on any reconciliation discrepancy

Getting this wrong can result in disbarment for the firm's partners. Build conservatively.

## Rate limits

- **15 requests/second** per access token.
- 429 returns standard `Retry-After`.
- Bulk endpoints exist for activities + contacts; use them for periodic sync rather than iterating single GETs.

## What this skill does NOT cover

- **Clio Grow** (CRM/intake product separate from Manage) — its own API; different OAuth scope.
- **Clio Draft** (document automation) — separate product.
- **Clio Payments** — Stripe-powered; if customer enabled it, treat as Stripe routes downstream.
- **Court e-filing** (PACER, Tyler Technologies) — different integrations; not on the Clio API path.
- **Conflict-check search heuristics** — beyond name + opposing-party lookup, conflict checking is jurisdiction-specific legal work; AutoFlow surfaces signals, humans decide.

## References

- API: https://developer.clio.com/api-reference
- Webhooks: https://developer.clio.com/api-reference/operation/webhookCreate
- OAuth: https://developer.clio.com/getting-started/authentication
- Regional bases: https://developer.clio.com/getting-started/regions
- Trust accounting compliance (general): https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_15_safekeeping_property/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; region captured at install; admin-user grant pattern)
