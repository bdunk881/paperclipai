---
name: jobber
description: Use this skill when an AutoFlow agent needs to read or write data in Jobber — the field-services management platform for home-services SMBs (HVAC, plumbing, electrical, lawn care, cleaning, pest control). Covers Jobber's GraphQL API + OAuth 2 auth, the Client / Property / Request / Quote / Job / Invoice / Visit model, and the workflow shape AutoFlow customers reach for (request → quote → job → invoice pipeline, technician dispatch, job completion → QBO invoice, customer review request).
---

# Jobber — field-services management

Jobber is the dominant SMB field-services management platform for home-services businesses — HVAC, plumbing, electrical, landscaping, cleaning, pest control, locksmithing, mobile mechanics. It absorbs the CRM + scheduling + dispatch + invoicing flows that mobile service businesses need.

Use Jobber when the customer **sends crews to customer addresses**. For office-bound services (legal, accounting, consulting), HubSpot + Calendly is the typical stack instead.

## When to reach for this skill

- **Request received** → triage routine (estimate priority, route to appropriate crew lead).
- **Quote sent** → fire CRM follow-up cadence, schedule a reminder before quote expires.
- **Job scheduled** → notify the assigned technician (Twilio SMS), confirm customer (SMS + email).
- **Visit completed** → push the visit details to QuickBooks as an invoice line item, fire customer review request (Google Business Profile, Yelp).
- **Invoice paid** → reconcile to QBO, log to revenue dashboard.
- **Recurring service due** → cron sweep for next-service dates, auto-schedule + notify.

## Authentication

Jobber uses **OAuth 2.0** exclusively. Standard authorization-code flow:

```
Authorization: Bearer <jobber-access-token>
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

`X-JOBBER-GRAPHQL-VERSION` is **required** on every request. Jobber versions its GraphQL schema per-call; omitting the header gets you the default at request time (unstable). Pin to a known release.

Access tokens last 1 hour; refresh tokens last 60 days and rotate on use. AutoFlow's `ticketSync` schema (`src/ticketSync/`) handles OAuth with refresh rotation.

Base URL: `https://api.getjobber.com/api/graphql`

Jobber's API is **GraphQL-only** — there's no REST surface. Agents that haven't worked with GraphQL need to:
- Query for exactly the fields they need (over-fetching is cheap; under-fetching means a second round trip)
- Use cursor pagination (`pageInfo.endCursor` + `pageInfo.hasNextPage`)
- Watch the per-query cost budget

## Core entity model

Jobber's data model maps to home-services workflows:

| Entity | What it is | Position in workflow |
|---|---|---|
| Client | The customer (homeowner, business) | Top of every workflow |
| Property | A physical address the client owns | Where work happens (one client can have many properties) |
| Request | An initial inquiry (web form, phone) | Earliest pipeline stage |
| Quote | A priced proposal | Send → customer accepts or rejects |
| Job | An accepted piece of work | Scheduled into one or more Visits |
| Visit | A single scheduled crew dispatch | Where actual work + time tracking happens |
| Invoice | Bill for completed work | Sent to client, paid via Jobber Payments or external |
| Time Sheet | Technician time entry per visit | Source for labor cost reporting |
| User | Office staff or field technician | Assigned to visits, jobs |

## Common AutoFlow workflows

### 1. New request → triage routine

```
Jobber webhook on requestCreate → Routine fires →
  1. GraphQL query: get request details + client + property
       query {
         request(id: $id) {
           title, source, requestStatus,
           client { id, name, emails { address }, phones { number } },
           property { id, address { street, city, postalCode } }
         }
       }
  2. LLM classification step: priority + service type from request.title
  3. PATCH request: assign to appropriate crew lead, set priority
  4. SMS lead (Twilio) acknowledging receipt: "Thanks {name}, we'll be
     in touch within 24h."
  5. Slack alert to #dispatch with the request URL.
```

### 2. Quote sent → reminder cadence

```
Jobber webhook on quoteSent → Routine fires →
  1. Schedule cron 3 days later: check if quote.status still "sent"
     (not "approved" or "rejected")
  2. If still pending, send a polite reminder SMS:
       "Hi {client.name}, just checking in on the quote for {service}."
  3. Schedule cron at quote.validUntil - 2 days: final reminder
  4. After validUntil: tag client "quote-expired" in HubSpot for nurture.
```

### 3. Visit completed → QBO invoice + review request

```
Jobber webhook on visitComplete → Routine fires →
  1. GraphQL query the visit + job + client + time-sheet entries +
     materials used:
       query {
         visit(id: $id) {
           startAt, endAt,
           job { id, title, client { ... } },
           timeSheetEntries { user { name }, duration },
           lineItems { name, quantity, unitCost }
         }
       }
  2. Build a QBO invoice (see quickbooks-online skill):
       CustomerRef = matched QBO customer
       Line[]      = job line items + (time × hourly rate)
  3. POST QBO /invoice, capture the invoice ID
  4. Mutate the Jobber job: add note "QBO Invoice #{number} created"
  5. Fire review-request routine: Twilio SMS with link to leave review
     on Google Business Profile or Yelp.
```

### 4. Recurring service auto-schedule

```
Cron routine daily →
  1. GraphQL query for jobs where recurring=true and next_visit_date
     within next 14 days, status not yet "scheduled"
  2. For each, create a Visit at the recurring interval (mutation
     visitCreate)
  3. SMS the assigned tech: "Reminder: {client} {service} scheduled
     for {date}"
  4. SMS the client: "Your next {service} is scheduled for {date}.
     Reply CONFIRM or CANCEL."
```

### 5. Invoice paid → reconciliation

```
Jobber webhook on invoicePaid → Routine fires →
  1. Query invoice for paymentDetails + jobReference
  2. POST QBO /payment matched to the QBO invoice ID stored earlier
  3. PATCH HubSpot deal (if linked) to "closed-won + paid"
  4. Log to the workspace revenue dashboard.
```

## GraphQL query / mutation shape

Jobber's GraphQL endpoint follows standard conventions:

```
POST /api/graphql
body:
  query: "query { ... }" OR "mutation { ... }"
  variables: { ... }
```

Common queries agents reach for:
- `clients(first: 50, filter: { ... })` — paginated client list
- `requests(first: 50, filter: { requestStatus: NEW })` — new requests for triage
- `visits(first: 50, filter: { startAt: { gte: ... } })` — upcoming visits

Common mutations:
- `clientCreate(input: { ... })` — new client
- `jobCreate(input: { ... })` — convert a quote to a scheduled job
- `invoiceCreate(input: { ... })` — bill for completed work
- `visitCreate(input: { ... })` — schedule a crew dispatch

## Idempotency

Jobber does NOT expose an idempotency-key. For mutations that must not duplicate (e.g. invoice creation from a webhook), check before creating — query for an existing invoice with a matching `jobId` and recent `createdAt` before mutating.

For client + property upserts, query by `email` or `name + address.postalCode` first.

## Webhooks

Subscribe via the API:

```
mutation {
  webhookCreate(input: {
    topic: "VISIT_COMPLETE",
    url: "https://autoflow.example/webhooks/jobber/{workspace_id}"
  }) { webhook { id, secret } }
}
```

Signature verification: `X-Jobber-Hmac-SHA256` is base64(HMAC-SHA256(body, webhook.secret)). **Verify before processing.**

Topics commonly subscribed:
- `REQUEST_CREATE`
- `QUOTE_SENT`, `QUOTE_APPROVED`
- `JOB_CREATE`, `JOB_COMPLETE`
- `VISIT_COMPLETE`
- `INVOICE_CREATE`, `INVOICE_PAID`
- `CLIENT_CREATE`

Replay safety: dedupe by webhook payload's `eventId`.

## Rate limits

- **Per-app GraphQL query cost budget**: 10,000 cost points per minute (default; can be raised on request).
- Each field has a cost; queries that pull deeply-nested data + many records can exhaust quickly. Always test with `extensions.cost` in the response to see actual usage.
- 429 returns standard `Retry-After`.

## What this skill does NOT cover

- **Jobber Payments** (their built-in payment processor) — distinct from Stripe/Square; if the customer uses Jobber Payments, invoice reconciliation flows through Jobber-native data rather than Stripe webhooks.
- **Jobber Online Booking** (customer-facing booking widget) — managed in Jobber UI; agents don't need to touch it.
- **GPS tracking / route optimization** — Jobber's built-in routing is operationally-focused and not exposed via API.
- **Marketing automation** — Jobber has a basic email layer; customers usually pair with Mailchimp/Klaviyo for nurture.

## References

- API: https://developer.getjobber.com/docs/
- GraphQL schema: https://developer.getjobber.com/docs/learn/graphql/
- Webhooks: https://developer.getjobber.com/docs/integrate/webhooks/
- OAuth: https://developer.getjobber.com/docs/learn/oauth/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; 60-day refresh-token rotation; GraphQL-version pin)
