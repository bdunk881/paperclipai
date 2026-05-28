---
name: gusto
description: Use this skill when an AutoFlow agent needs to read or write payroll data in Gusto — list employees and contractors, look up payrolls, react to payroll-run events (push expenses to QuickBooks, alert on new hires), pull pay-stub or W2 metadata for compliance routines. Covers Gusto's Embedded Partner OAuth 2 auth, the company-scoped resource model (Company / Employee / Contractor / Payroll / PayPeriod), and the workflow shape AutoFlow customers reach for (payroll run → QBO journal entry, new hire → onboarding routine, contractor 1099 → year-end export).
---

# Gusto — payroll, benefits, HR

Gusto is the dominant payroll platform for AutoFlow's SMB segment (under ~250 employees). It owns the "pay people correctly" surface and exports cleanly to QuickBooks — so every payroll run becomes journal entries on the customer's books.

## When to reach for this skill

- **Payroll run completed** → post journal entries to QuickBooks (wages, taxes, benefits) so the customer's books match Gusto's report.
- **New hire** → fire an onboarding routine (provision tools, send welcome email, schedule HR meeting via Calendly).
- **Contractor 1099 created** → flag for year-end review, kick off the W-9 collection workflow.
- **Pay-stub pulled** → respond to an employee request via a support routine.
- **Termination** → revoke access in connected tools, schedule offboarding tasks.
- **Compliance reporting** — pull quarterly totals for state filings, year-end W2/1099 export.

## Authentication

Gusto uses **OAuth 2.0** exclusively — there's no API-key path for production data. Two flavors:

- **Embedded Payroll** — for SaaS partners (AutoFlow's path). Each customer connects their Gusto company once via the standard authorization-code flow. Refresh tokens last indefinitely but the access token is short-lived (~2 hours).
- **Demo / Sandbox** — `api.gusto-demo.com` for testing. Always confirm env before any write.

```
Authorization: Bearer <gusto-access-token>
```

Base URL: `https://api.gusto.com/v1/`

**Multi-company gotcha**: a single Gusto user can own multiple companies (e.g. a parent + subsidiaries). After OAuth, call `GET /v1/me` to enumerate accessible companies. AutoFlow's connection record needs to pin a specific `company_uuid` per-connection so subsequent writes don't go to the wrong books.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Me | `/v1/me` | Bootstrap — list accessible companies |
| Company | `/v1/companies/{company_uuid}` | The employer record (name, EIN, locations) |
| Employee | `/v1/companies/{uuid}/employees` | W-2 worker records |
| Contractor | `/v1/companies/{uuid}/contractors` | 1099 worker records |
| Payroll | `/v1/companies/{uuid}/payrolls` | A single payroll run |
| Payroll Detail | `/v1/companies/{uuid}/payrolls/{payroll_uuid}` | Line items, taxes, totals |
| Pay Period | `/v1/companies/{uuid}/pay_periods` | The schedule (weekly, biweekly, etc.) |
| Job | `/v1/employees/{uuid}/jobs` | Position + compensation history |
| Compensation | `/v1/jobs/{uuid}/compensations` | Rate changes over time |
| Bank Account | `/v1/companies/{uuid}/bank_accounts` | Where wages are drawn from |
| Federal Tax | `/v1/companies/{uuid}/federal_tax_details` | EIN, filing form (941 vs 944) |

## Common AutoFlow workflows

### 1. Payroll run completed → QuickBooks journal entries

```
Gusto webhook payroll.processed (or cron poll) → Routine fires →
  1. GET /v1/companies/{uuid}/payrolls/{payroll_uuid} for line totals
  2. Build journal entry lines:
       - Debit Payroll Expense (gross wages)
       - Debit Payroll Tax Expense (employer-side FICA, FUTA, SUTA)
       - Debit Benefits Expense (if any)
       - Credit Payroll Clearing or Bank (net pay total)
       - Credit Payroll Liabilities (employee + employer tax withholdings)
  3. POST QBO /journalentry (see quickbooks-online skill) with the lines,
     PrivateNote: "Gusto payroll {payroll_uuid} for period {pay_period}"
  4. Tag the Gusto payroll with the QBO journal_entry_id via AutoFlow's
     side-store (Gusto doesn't accept arbitrary metadata).
```

### 2. New hire → onboarding routine

```
Gusto webhook employee.created → Routine fires →
  1. GET /v1/employees/{employee_uuid} for name, email, start_date
  2. Fire the onboarding playbook:
       - Create accounts in connected tools (Slack, HubSpot, Google Workspace)
       - Send welcome email via Mailchimp or HubSpot
       - Schedule a manager 1:1 via Calendly
       - Post to the #new-hires Slack channel
  3. PATCH the employee onto a workspace-level "new hire" tag for
     follow-up reporting (30/60/90-day check-ins).
```

### 3. Contractor created → W-9 collection

```
Gusto webhook contractor.created → Routine fires →
  1. GET /v1/contractors/{uuid} for email + entity type
  2. POST DocuSign /envelopes with the W-9 template, signer = contractor.email
     (see docusign skill)
  3. On envelope-completed, GET the executed PDF and POST to Gusto
     /v1/contractors/{uuid}/documents (Gusto stores tax docs alongside
     the contractor record)
  4. Tag in HubSpot as "contractor-onboarded" for the year-end 1099 audit.
```

### 4. Year-end 1099 export

```
Cron routine on Jan 5 →
  1. GET /v1/companies/{uuid}/contractors for all contractors
  2. For each, GET /v1/contractors/{uuid}/payments?year=2025 for totals
  3. Filter to contractors with >$600 paid (1099-NEC threshold)
  4. Bundle into a CSV or trigger Gusto's native 1099 form generation
     (/v1/contractors/{uuid}/documents endpoint type=1099_nec)
  5. Mail or e-deliver via DocuSign Click for acknowledgement.
```

## Idempotency

Gusto does not expose an Idempotency-Key header. AutoFlow's write routines should:
- Check before creating (e.g. `GET .../employees?email=...` before POST employee)
- Use the `external_id` field where Gusto supports it (employee + contractor records) to store an AutoFlow correlation ID

## Webhooks

Gusto's webhook system is **subscription-based via the partner API**. AutoFlow registers webhook URLs at integration-setup time per company:

```
POST /v1/companies/{uuid}/webhook_subscriptions
body:
  url: "https://autoflow.example/webhooks/gusto/{workspace_id}"
  subscription_types: ["payroll.processed", "employee.created", "contractor.created"]
```

Signature verification: `X-Gusto-Signature` is an HMAC-SHA256 of the body using a per-subscription secret returned at subscription-create time. **Verify before processing** — payroll events are high-value targets for spoofing.

Replay safety: dedupe by the `event_uuid` field in the payload (Gusto's stable event ID).

## Rate limits

- **200 requests/minute** per partner per company (industry-standard for HRIS APIs).
- 429 returns `Retry-After`. The API is small enough that AutoFlow routines rarely hit it.
- For bulk-employee operations (e.g. annual census export), use the `?per_page=100` pagination and process serially.

## What this skill does NOT cover

- **Benefits administration** (medical, dental, 401(k)) — separate API surface (`/v1/companies/{uuid}/employee_benefits`) and complex; author its own skill when a customer needs it.
- **Time tracking** — Gusto Time is a recent add-on with a different endpoint shape (`/v1/time_off_requests`). Skill its own file when needed.
- **State / local tax setup** — done in the Gusto UI by the employer's bookkeeper; AutoFlow doesn't touch it.
- **Direct deposit splits** — employee-side configuration in Gusto's portal.

## References

- API: https://docs.gusto.com/embedded-payroll/reference/
- OAuth: https://docs.gusto.com/embedded-payroll/docs/authentication
- Webhooks: https://docs.gusto.com/embedded-payroll/docs/webhooks
- Embedded Payroll partner program: https://gusto.com/embedded-payroll
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; long-lived refresh tokens)
