---
name: quickbooks-online
description: Use this skill when an AutoFlow agent needs to read or write accounting data in QuickBooks Online — sync invoices, look up customers/vendors, create journal entries, pull reports for the period close. Covers the OAuth 2 + bearer-token authentication model, the V3 REST API surface, and the workflow shape AutoFlow customers reach for (invoice from a sale, expense from a receipt, reconcile a Stripe payout).
---

# QuickBooks Online — SMB accounting

QuickBooks Online (QBO) is the dominant accounting tool for US small businesses. AutoFlow customers who sell goods/services usually use it as the system of record for invoices, payments, expenses, and tax-prep exports.

## When to reach for this skill

- Customer needs **invoices created** from another system (CRM deal closed, Shopify order, contract signed in DocuSign).
- Customer needs **payments reconciled** (Stripe payout → matched against QBO invoice).
- Customer needs **expenses captured** from receipts, vendor bills, or recurring SaaS charges.
- Customer needs **reports pulled** at period close (P&L, balance sheet, AR aging).
- An accounting agent is running a **routine** that touches QBO data.

## Authentication

QBO uses **OAuth 2.0** with refresh tokens. Two facts that shape every integration:

1. **Tokens are scoped to a single `realmId`** (the QBO company file). One AutoFlow workspace may have *multiple* QBO realms — e.g. a holding company with subsidiaries — and you must keep tokens + realmId paired.
2. **Refresh tokens rotate every 100 days.** If a workspace's QBO connection has been idle longer than that, the refresh token is revoked and the customer must re-authorize. AutoFlow's `ticketSync` connection schema (`src/ticketSync/`) already has the pattern for `oauth2_pkce` storage; QBO fits that shape.

Sandbox vs production: QBO has separate **sandbox** companies (`sandbox-quickbooks.api.intuit.com`) for testing. Always confirm the env before any write operation.

### Auth header

```
Authorization: Bearer <access_token>
Accept: application/json
```

## Core API surface

Base URL: `https://quickbooks.api.intuit.com/v3/company/{realmId}/`

### Entities AutoFlow agents work with most often

| Entity | Endpoint | Common ops |
|---|---|---|
| Customer | `/customer/<id>` | Read, create on first invoice |
| Invoice | `/invoice/<id>` | Create, send, mark paid |
| Payment | `/payment/<id>` | Record against an invoice or bundle of invoices |
| Item | `/item` | List for invoice line items (product or service catalog) |
| Bill | `/bill/<id>` | Vendor bill (the expense side of an invoice) |
| Expense (Purchase) | `/purchase/<id>` | One-shot expense like a SaaS subscription charge |
| Account | `/account` | The chart of accounts — needed to post journal entries |
| JournalEntry | `/journalentry/<id>` | Manual debits/credits for adjustments |

### Reports (read-only)

- `/reports/ProfitAndLoss?start_date=2026-01-01&end_date=2026-03-31`
- `/reports/BalanceSheet?as_of_date=2026-03-31`
- `/reports/AgedReceivables`

Reports return a fixed JSON tree — they're hierarchical, not flat. Plan to walk `Rows.Row[]` recursively when extracting line items.

## Common AutoFlow workflows

### 1. Create an invoice from a CRM-closed deal

```
HubSpot deal: closed-won → Routine fires →
  1. Look up or create QBO Customer (match by email)
  2. Map deal line items to QBO `Item.Ref` → `Invoice.Line[]`
  3. POST /invoice with `CustomerRef`, `Line[]`, `DueDate`
  4. Optionally POST /invoice/<id>/send (emails the invoice via QBO)
```

### 2. Reconcile a Stripe payout against open invoices

```
Stripe webhook payout.paid → Routine fires →
  1. List Stripe charges in the payout's balance_transactions
  2. For each charge with an `invoice` metadata key,
     GET /invoice/<id> from QBO, confirm Balance > 0
  3. POST /payment with `CustomerRef`, `Line[].LinkedTxn[]` pointing at the invoice IDs
  4. Annotate the payment's `PrivateNote` with the Stripe payout ID for audit
```

### 3. Capture a recurring SaaS charge as an expense

```
Stripe invoice.paid for a subscription → Routine fires →
  1. POST /purchase with:
       PaymentType: "CreditCard"
       AccountRef: "<corporate-card-account-id>"
       Line[]: { AccountRef: "<SaaS-expense-account-id>", Amount }
       VendorRef: "<looked-up-or-created>"
  2. Attach the Stripe invoice PDF via /upload (multipart, see "Attachments")
```

## Idempotency

QBO supports `RequestId` header on POSTs to prevent duplicate creation on retry. Use a deterministic ID per logical operation — for invoices from CRM deals, hash `realmId|deal_id` — so a routine retry doesn't double-bill the customer.

## Rate limits

- **500 requests/minute per realm.** Heavy enough that most routines don't trip it.
- **Throttle 429** returns `Retry-After` in seconds. Honor it; QBO is a system of record and we don't want to disrupt the customer's books.

## Error handling

QBO returns errors in a wrapper:

```json
{
  "Fault": {
    "Error": [
      { "Message": "Object Not Found", "code": "610", "Detail": "..." }
    ],
    "type": "ValidationFault"
  }
}
```

Common codes:
- `610` — entity doesn't exist (often a sync gap; fall back to "look up by name")
- `6240` — stale ETag on update; refetch and retry
- `3200` — auth scope insufficient; signals the customer needs to re-authorize with the broader scope

## Attachments

`/upload` accepts multipart with the file + an `AttachableRef` pointing at any QBO entity. Useful for attaching the original receipt/invoice PDF to an Expense or Invoice so the customer's accountant has it at period close.

## Webhooks

QBO will POST to a customer-configured URL when entities change. AutoFlow ingests via the existing `src/integrations/` webhook pattern. Use webhooks for **change detection**; never for state-of-truth — always re-fetch the entity before acting.

## What this skill does NOT cover

- **QuickBooks Desktop** (a separate product with a SOAP-y SDK; we don't currently target it).
- **Intuit ProConnect / Tax** (separate API, separate auth).
- **Payroll** — Intuit Online Payroll is its own product surface; treat it as a separate integration.

## References

- API explorer: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities
- OAuth 2 flow: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store pattern)
