---
name: docusign
description: Use this skill when an AutoFlow agent needs to send contracts for e-signature, monitor signing progress, react to completion (fire downstream invoice / onboarding), or pull executed contracts back into the workspace. Covers DocuSign eSignature REST API v2.1, OAuth + JWT auth (the JWT user-impersonation flow is the AutoFlow pattern), the Envelope / Recipient / Tab model, and the workflow shape AutoFlow customers reach for (deal closed → contract send, contract signed → invoice + onboarding, status check → reminder cadence).
---

# DocuSign — contract e-signature

DocuSign is the dominant e-signature platform for AutoFlow's SMB segment that closes contracts. It sits between deal-closed in the CRM and invoice-issued in accounting — the contract execution gate.

## When to reach for this skill

- **Deal closed → contract send** — HubSpot deal moves to `contract-out`; route the template + signer info to DocuSign.
- **Contract signed → invoice + onboarding** — fire QBO invoice, send welcome sequence, provision the customer.
- **Contract void / declined** → update CRM stage, alert sales rep.
- **Reminder cadence** — chase signatures that have been open >N days.
- **Pull executed PDF** — store back in Drive/Dropbox + attach to the QBO invoice.
- **Status reporting** — periodic snapshot of envelopes-in-flight to a dashboard.

## Authentication

Two flows that matter:

- **Authorization Code Grant** — interactive, requires a browser. Use only when the user is in front of a screen.
- **JWT Bearer Grant** (impersonation) — server-side. This is the AutoFlow pattern: AutoFlow's app impersonates a workspace user (the "account admin" the customer designates at install) and acts on their behalf. Tokens last 1 hour; AutoFlow re-mints before expiry.

```
Authorization: Bearer <docusign-access-token>
```

For JWT: AutoFlow signs a JWT with a private key (registered against the integration key in DocuSign Admin), POSTs to `/oauth/token`, and receives an access token. Standard library: `docusign-esign` SDK does this end-to-end.

### Account ID + base URI

After auth, the first call is `GET /v2.1/userinfo` to get the user's accounts. Each account has its own `base_uri` (DocuSign sharded — `na1`, `na2`, `eu`, etc.) — every subsequent call goes to that base.

```
{base_uri}/restapi/v2.1/accounts/{account_id}/
```

Cache `(account_id, base_uri)` on the AutoFlow connection record at install time.

Sandbox: `https://account-d.docusign.com` for demo accounts. Production: `https://account.docusign.com`. Set this per-connection.

## Core API surface

DocuSign is **Envelope-centric**. Almost everything goes through an Envelope.

| Resource | Endpoint | What it's for |
|---|---|---|
| Envelope | `/envelopes/{envelope_id}` | The container for a contract send |
| Envelope Documents | `/envelopes/{id}/documents/{doc_id}` | The PDFs in the envelope |
| Envelope Recipients | `/envelopes/{id}/recipients` | Who signs, in what order |
| Envelope Tabs | `/envelopes/{id}/recipients/{recipient_id}/tabs` | Signature fields, date fields, text fields placed on the document |
| Templates | `/templates/{template_id}` | Reusable contract patterns |
| Envelope Status | `/envelopes/{id}` (GET) | `sent`, `delivered`, `completed`, `declined`, `voided` |
| Audit Log | `/envelopes/{id}/audit_events` | Compliance trail |
| Connect (webhooks) | `/connect` | Manage push-event subscriptions |

## Common AutoFlow workflows

### 1. Deal closed → template-based contract send

```
HubSpot deal closed-won → Routine fires →
  1. POST /envelopes
       templateId: <stored on deal as a custom property, or by deal type>
       templateRoles: [
         { roleName: "Client", email: contact.email, name: contact.fullname,
           tabs: { textTabs: [{ tabLabel: "company-name", value: deal.company.name }] } }
       ]
       status: "sent"  (otherwise it stays as a draft)
       customFields: { textCustomFields: [{ name: "hubspot_deal_id", value: deal.id }] }
  2. The envelope_id returned goes onto the HubSpot deal as `docusign_envelope_id`.
  3. DocuSign emails the signer. Listen for `envelope-completed` (workflow 2).
```

### 2. Contract signed → invoice + onboarding

```
DocuSign Connect webhook envelope-completed → Routine fires →
  1. Verify the HMAC signature (see Webhooks)
  2. Read customFields.hubspot_deal_id from the payload
  3. HubSpot PATCH deal: { properties: { dealstage: "contract-signed",
                                          contract_signed_at: now } }
  4. POST QBO /invoice for the deal's line items (see quickbooks-online skill)
  5. Enroll the contact in the onboarding sequence (see hubspot-crm skill)
  6. GET /envelopes/{id}/documents/combined to fetch the executed PDF
  7. POST QBO /upload to attach the PDF to the invoice as AttachableRef
```

### 3. Reminder cadence for open envelopes

```
Cron routine daily →
  1. GET /envelopes?status=sent&from_date={now - 7d}&to_date={now - 3d}
     (paginate; envelopes sent 3-7 days ago without completion)
  2. For each, POST /envelopes/{id}/notification
       useAccountDefaults: false
       reminders: { reminderEnabled: true, reminderDelay: 1, reminderFrequency: 2 }
     OR send a Slack alert to the deal owner ("Acme still hasn't signed").
```

### 4. Declined / voided → CRM rollback

```
Connect webhook envelope-declined or envelope-voided → Routine fires →
  1. Read deal_id from customFields
  2. HubSpot PATCH deal: { properties: { dealstage: "negotiation",
                                          contract_status: "declined" } }
  3. POST Slack alert to deal owner with the declined reason from the
     payload (recipients[].declinedReason).
```

## Idempotency

DocuSign supports `X-DocuSign-Idempotency-Key` on POST envelopes — use it. Deterministic key per logical send (e.g. `hubspot-deal-{deal_id}-contract-v{version}`) prevents duplicate envelopes if the routine retries.

## Webhooks (DocuSign Connect)

Subscribe to envelope events via the Admin UI or `/connect` API:

```
POST /connect
body:
  name: "AutoFlow workspace {workspace_id}"
  urlToPublishTo: "https://autoflow.example/webhooks/docusign/{workspace_id}"
  envelopeEvents: ["envelope-sent", "envelope-completed", "envelope-declined", "envelope-voided"]
  recipientEvents: ["recipient-completed"]
  includeData: ["recipients", "tabs", "customFields"]
```

Signature verification: `X-DocuSign-Signature-1` is an HMAC-SHA256 of the body using the secret configured at Connect-setup time. **Always verify before processing** — webhook URLs are often discoverable.

Connect retries on handler failure (5xx) with exponential backoff for 24 hours. Make handlers idempotent.

## Rate limits

- **1,000 API calls per hour** per integration on Standard plans (more on Enterprise).
- **Hourly burst** capped at ~10% of the daily limit.
- 429 returns standard `Retry-After`. The SDK doesn't auto-retry; wrap calls.

## What this skill does NOT cover

- **DocuSign CLM** (Contract Lifecycle Management — the upmarket product) — separate API and price tier, rarely on SMB path.
- **DocuSign Rooms for Real Estate** — vertical-specific, separate auth model.
- **DocuSign Identify** (ID verification add-on) — enabled per-envelope via tab config; doesn't need its own skill.
- **DocuSign Click** (clickwrap for terms of service) — separate product with a simpler API; skill its own file when authored.

## References

- API: https://developers.docusign.com/docs/esign-rest-api/reference/
- JWT auth: https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
- Connect (webhooks): https://developers.docusign.com/platform/webhooks/connect/
- Idempotency: https://developers.docusign.com/docs/esign-rest-api/how-to/idempotency/
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; JWT private key stored alongside the integration key)
