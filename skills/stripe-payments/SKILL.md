---
name: stripe-payments
description: Use this skill when an AutoFlow agent needs to charge customers, manage subscriptions, reconcile payouts, or react to payment events in Stripe — issue a refund, create a Checkout session for a closed CRM deal, sync a paid invoice back to QuickBooks, fire a routine on subscription cancellation. Covers Stripe's restricted-key auth, the Charges / PaymentIntents / Subscriptions / Invoices model, idempotency, webhook signature verification, and the workflow shape AutoFlow customers reach for (one-time checkout, subscription lifecycle, payout reconciliation).
---

# Stripe — payments, subscriptions, payouts

Stripe is the default payment processor for AutoFlow's SMB segment. It's adjacent to almost every other tool: invoices flow to QuickBooks, customers map to HubSpot, subscriptions drive retention metrics, payouts reconcile into the books.

## When to reach for this skill

- **Charge a customer** for a one-time amount (closed deal, completed project, invoice payment).
- **Manage subscriptions** — create, upgrade/downgrade, cancel, react to renewal events.
- **Reconcile a payout** — match the deposit in the business bank account back to individual charges and post a journal entry to QBO.
- **Issue a refund** — full or partial, triggered by support routine.
- **Cross-tool joins** — Stripe Customer ↔ HubSpot Contact, Stripe Invoice ↔ QBO Invoice.
- **Subscription lifecycle automation** — fire onboarding on subscription start, churn-risk routine on past-due, retention offer on cancel.

## Authentication

Stripe uses **restricted secret keys** (live keys start with `sk_live_…`, test keys with `sk_test_…`). Always prefer restricted keys over the unrestricted secret — scope to only the resources AutoFlow needs.

```
Authorization: Bearer <stripe-restricted-secret-key>
```

For multi-tenant SaaS apps, Stripe Connect lets you charge on behalf of connected accounts:

```
Stripe-Account: acct_xxxxxxxxxxxxxxxx
```

Test vs live: separate keys, separate dashboards, separate data. Always confirm the mode before any write — accidentally charging real cards in test logic (or vice versa) is the #1 incident pattern. AutoFlow workspace settings should pin the mode explicitly.

Base URL: `https://api.stripe.com/v1/` (REST, form-encoded bodies — Stripe is famously not JSON-on-input).

## Core API surface

Stripe has a wide API; AutoFlow agents touch a focused slice:

| Resource | What it is | AutoFlow pattern |
|---|---|---|
| Customer | A buyer | Upsert by email; store the Stripe ID on HubSpot Contact + QBO Customer |
| PaymentIntent | A confirmable charge attempt | Modern one-time charge; use for new flows |
| Charge | The legacy charge object | Read-only for old data; new flows use PaymentIntent |
| Invoice | Stripe-side billing record | Mirrors QBO Invoice for subscription customers |
| InvoiceItem | Pre-invoice line item | Build draft invoices for usage billing |
| Subscription | Recurring billing | Lifecycle source for churn / renewal routines |
| Price + Product | Catalog of recurring offers | Defined in Stripe; never authored from AutoFlow |
| CheckoutSession | Hosted checkout page | The simplest way to take a one-time or subscription payment |
| Payout | Money landing in the bank | Source of truth for QBO journal entries |
| BalanceTransaction | Every entry in Stripe's ledger | Reconciliation primitive |
| Refund | Money returned to the buyer | Triggered by support routines |
| Webhook Endpoint | Subscription to events | Configured at integration-install time |

## Common AutoFlow workflows

### 1. Closed CRM deal → Checkout session

```
HubSpot deal closed-won → Routine fires →
  1. Look up the deal's line items + contact
  2. POST /v1/checkout/sessions
     mode=payment, customer_email=contact.email
     line_items[]: { price_data: { ... }, quantity }
     success_url, cancel_url
     metadata: { hubspot_deal_id, autoflow_routine_run_id }
  3. Email the contact the checkout URL (via Mailchimp or the HubSpot send API)
  4. Listen for checkout.session.completed webhook (see workflow 3 below)
```

### 2. Subscription upgrade → prorated invoice

```
Customer requests an upgrade in-app → Routine fires →
  1. GET /v1/subscriptions/{id} for current items + period
  2. POST /v1/subscriptions/{id} with items[] updated to the new price,
     proration_behavior=create_prorations
  3. Stripe immediately invoices the prorated difference; the
     customer.subscription.updated + invoice.created webhooks fire
  4. Route the new invoice to QBO (see workflow 4)
```

### 3. checkout.session.completed → mark deal paid + QBO invoice

```
Stripe checkout.session.completed webhook → Routine fires →
  1. Verify signature with Stripe-Signature + endpoint secret
  2. Read session.metadata.hubspot_deal_id
  3. HubSpot PATCH deal: { properties: { dealstage: "paid", stripe_session_id } }
  4. POST QBO /invoice + /payment for the line items (or annotate an
     existing draft invoice from the deal-closed routine).
```

### 4. Stripe payout → QBO journal entry

```
Stripe payout.paid webhook (daily) → Routine fires →
  1. GET /v1/balance_transactions?payout={payout_id}&limit=100
     (paginate; payouts can have hundreds of entries)
  2. Aggregate by transaction.type:
       - charge → credit Revenue, debit Stripe Clearing
       - refund → reverse
       - fee  → debit Stripe Fees expense
       - payout → debit Bank, credit Stripe Clearing
  3. POST QBO /journalentry with the lines
  4. Tag the journal entry's PrivateNote with the Stripe payout_id for audit
```

### 5. Subscription churn-risk routine

```
Cron routine daily →
  1. List subscriptions where status in (past_due, unpaid)
     /v1/subscriptions?status=past_due&limit=100 (paginate)
  2. For each, look up the HubSpot contact by metadata
  3. Fire the "churn outreach" sequence (Mailchimp or HubSpot Workflows)
  4. Optionally: post a Slack alert to Customer Success
```

## Idempotency

Stripe **strongly recommends** an idempotency key on every POST. Use a deterministic key per logical operation:

```
Idempotency-Key: routine-run-{run_id}-checkout-session
```

If the routine retries, Stripe returns the original result instead of creating a duplicate charge.

## Webhooks

Signature verification: `Stripe-Signature` header carries a timestamp + signature. **Always verify before processing** — without this, anyone can POST fake events to AutoFlow. Use the official Stripe SDK's `stripe.webhooks.constructEvent()` rather than hand-rolling.

Common topics agents subscribe to:
- `checkout.session.completed`
- `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `payout.paid`
- `charge.refunded`, `charge.dispute.created` (dispute is high-priority — page the ops team)

Replay safety: Stripe redelivers events on handler failure. Dedupe by `event.id` (Stripe-side UUID) in AutoFlow's webhook ingest table.

## Rate limits

**100 requests/sec** in live mode, **25 req/sec** in test. Bursts allowed via token bucket. 429 returns `Stripe-Should-Retry: true`. The Stripe SDK has built-in retry with exponential backoff — use it.

For bulk reads (payout reconciliation, batch refunds), prefer **Search** (`/v1/charges/search?query=...`) or paginate carefully.

## Multi-currency

Every amount is in the **smallest currency unit** (cents for USD, but Yen are 1:1, BHD is 1000:1). Always read `currency` alongside `amount` and use a money library when converting.

## What this skill does NOT cover

- **Stripe Tax** — separate product, separate API; only relevant if the customer enabled it.
- **Stripe Issuing** (corporate card issuance) — most SMB customers don't use it.
- **Stripe Terminal** (in-person POS) — separate hardware integration.
- **Radar rules** (fraud) — Stripe-side configuration, not AutoFlow's job.

## References

- API: https://stripe.com/docs/api
- Webhooks: https://stripe.com/docs/webhooks
- Idempotency: https://stripe.com/docs/api/idempotent_requests
- Connect (multi-tenant): https://stripe.com/docs/connect
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store pattern; we already ship a Stripe billing adapter at `src/billing/`)
