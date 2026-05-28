---
name: hubspot-crm
description: Use this skill when an AutoFlow agent needs to read or write CRM data in HubSpot — find or create contacts/companies/deals, advance deal stages, log activities, sync HubSpot pipeline data with QuickBooks invoices or Stripe charges, fire downstream routines on deal-stage transitions. Covers HubSpot's private-app token auth, the v3 CRM API surface, and the workflow shape AutoFlow customers reach for (deal closed → invoice, lead form → contact + sequence enroll, support ticket → company-level signal).
---

# HubSpot CRM — sales & marketing system of record

HubSpot is the most common CRM for AutoFlow's SMB segment, especially Sales Hub / Marketing Hub customers. It sits upstream of accounting (QuickBooks) and downstream of marketing tools (Mailchimp, ad platforms). Agents touching customer lifecycle data almost always pass through HubSpot.

## When to reach for this skill

- **Deal stage transitions** — a deal moves to `closedwon` → fire QBO invoice, Stripe checkout, contract send, onboarding routine.
- **Lead capture** — form/webhook → upsert Contact → enroll in a sequence or assign an owner.
- **Activity logging** — agent calls/emails/meetings need to land on the Contact timeline.
- **Pipeline reporting** — period-close stage analysis, conversion rate by source.
- **Cross-tool joins** — match a Stripe customer to a HubSpot Contact by email.

## Authentication

Default to **Private App tokens** (introduced 2022, recommended for server-side integrations). API Keys are deprecated.

```
Authorization: Bearer pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Scopes are picked at app-install time per the integration. AutoFlow's `ticketSync` connection schema (`src/ticketSync/`) supports the `api_key` auth method we use for tokens. For OAuth-app installs (multi-customer scenarios), HubSpot also supports OAuth 2.0 — but private apps cover most SMB cases.

Portal regions: HubSpot has US (`na1`) and EU (`eu1`) data residency. The token prefix tells you which, and the base URL changes accordingly. Always read the customer's portal region before the first call.

Base URL: `https://api.hubapi.com/`

## Core CRM v3 object surface

HubSpot's CRM is organized around **objects** (Contact, Company, Deal, Ticket, plus custom) and **associations** between them. Every entity uses the same shape — `properties` map + `associations` list — which makes the surface predictable.

| Object | Endpoint base | Default props worth knowing |
|---|---|---|
| Contact | `/crm/v3/objects/contacts` | `email`, `firstname`, `lastname`, `phone`, `lifecyclestage`, `hubspot_owner_id` |
| Company | `/crm/v3/objects/companies` | `name`, `domain`, `industry`, `numberofemployees`, `annualrevenue` |
| Deal | `/crm/v3/objects/deals` | `dealname`, `amount`, `dealstage`, `pipeline`, `closedate`, `hubspot_owner_id` |
| Ticket | `/crm/v3/objects/tickets` | `subject`, `content`, `hs_pipeline`, `hs_pipeline_stage` |
| Line Item | `/crm/v3/objects/line_items` | `quantity`, `price`, `hs_product_id` |
| Product | `/crm/v3/objects/products` | `name`, `price`, `description` |

### Common reads

```
# Find a contact by email (the most common SMB lookup)
GET /crm/v3/objects/contacts/{email}?idProperty=email

# Get a deal with its associated contacts and line items
GET /crm/v3/objects/deals/{dealId}?associations=contacts,line_items

# Search by arbitrary criteria
POST /crm/v3/objects/contacts/search
Body: { "filterGroups": [{ "filters": [{ "propertyName": "email", "operator": "EQ", "value": "..." }] }] }
```

### Common writes

```
# Upsert a contact (HubSpot won't dup by email automatically — use the upsert endpoint)
PUT /crm/v3/objects/contacts/{email}?idProperty=email
Body: { "properties": { "firstname": "...", "company": "..." } }

# Move a deal to a new stage
PATCH /crm/v3/objects/deals/{dealId}
Body: { "properties": { "dealstage": "closedwon" } }

# Associate a deal with a contact
PUT /crm/v3/objects/deals/{dealId}/associations/contacts/{contactId}/deal_to_contact
```

## Common AutoFlow workflows

### 1. Deal closed → fire downstream invoice + onboarding

```
HubSpot webhook deal.propertyChange (dealstage → closedwon) → Routine fires →
  1. GET /crm/v3/objects/deals/{dealId}?associations=contacts,line_items,companies
  2. Map line_items → QBO Invoice.Line[] (see quickbooks-online skill)
  3. POST QBO /invoice; capture the invoice ID
  4. PATCH the HubSpot deal: { properties: { quickbooks_invoice_id: "..." } }
     (Custom property created once on the deal object.)
  5. Optionally enroll the primary contact in an onboarding sequence.
```

### 2. Lead form → contact + sequence enroll

```
HubSpot form.submitted webhook OR a custom landing-page → Routine fires →
  1. PUT /crm/v3/objects/contacts/{email}?idProperty=email
     with the form fields mapped to HubSpot props.
  2. Look up the appropriate sequence by name (cache the sequenceId).
  3. POST /automation/v4/flows/{flowId}/enrollments (Workflows API)
     to enroll the contact in the nurture flow.
```

### 3. Cross-tool join — Stripe customer ↔ HubSpot contact

```
Stripe customer.created webhook → Routine fires →
  1. PUT /crm/v3/objects/contacts/{customer.email}?idProperty=email
     with the Stripe customer ID stored in a `stripe_customer_id` custom property.
  2. Reverse: when looking up "who is this Stripe charge for?" do a
     HubSpot search by `stripe_customer_id` to get the Contact + its associations.
```

## Idempotency

HubSpot's upsert-by-property-value (`?idProperty=email`) is naturally idempotent. For deal/ticket creation where there's no natural unique key, AutoFlow should store the source-system ID (e.g. the routine run ID, the Stripe checkout session ID) in a custom property and **search before creating** to avoid duplicates on retry.

## Rate limits

- **190 requests / 10 seconds** per integration token (Enterprise tier higher).
- **40,000 requests / day** for Sales / Marketing Hub Pro accounts.
- 429 responses include a standard `Retry-After` header — honor it.

Batch endpoints (`/crm/v3/objects/contacts/batch/upsert`) accept up to 100 records per call and count as a **single** request — use them for bulk syncs.

## Webhooks

HubSpot can POST to AutoFlow on Contact/Company/Deal/Ticket changes. The payload arrives as an **array** of change events (not one per request); your handler must iterate. Subscriptions are configured at the integration level, not per-portal — meaning every customer on that integration gets the same event types.

Signature verification: HubSpot signs the request body with the integration's client secret in `X-HubSpot-Signature-v3`. Validate it before trusting any payload. Ingest pattern: `src/integrations/` follows the standard verification shape.

## Custom properties

For any AutoFlow ↔ HubSpot sync, **create custom properties** to store the foreign IDs:
- `autoflow_routine_id` on Contact / Deal / Ticket — for traceability
- `quickbooks_invoice_id` on Deal — for the closed-won flow
- `stripe_customer_id`, `stripe_subscription_id` on Contact
- `last_synced_at` (datetime) — to detect drift

`POST /crm/v3/properties/{objectType}` creates them once at integration-install time.

## What this skill does NOT cover

- **HubSpot CMS** (websites, blog) — different API namespace, rarely on the SMB AutoFlow path.
- **Marketing Hub email send** — covered by the dedicated marketing-automation skills (`mailchimp`, `klaviyo`) when those exist.
- **Custom Behavioral Events** — possible but expensive and rarely needed for SMB use cases.

## References

- API: https://developers.hubspot.com/docs/api/overview
- CRM v3 objects: https://developers.hubspot.com/docs/api/crm/understanding-the-crm
- Webhooks: https://developers.hubspot.com/docs/api/webhooks
- Private apps: https://developers.hubspot.com/docs/api/private-apps
- AutoFlow integration shape: `src/ticketSync/` (api_key auth + secrets-store pattern)
