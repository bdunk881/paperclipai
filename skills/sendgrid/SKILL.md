---
name: sendgrid
description: Use this skill when an AutoFlow agent needs to send transactional email via SendGrid — order confirmations, password resets, receipts, invoice notifications, alerts. Distinct from marketing email (Mailchimp / Klaviyo). Covers the v3 REST API with single-API-key auth, the Mail Send / Templates / Inbound Parse / Suppressions / Event Webhook surfaces, and the workflow shape AutoFlow customers reach for (one-shot transactional notification, dynamic-template-driven receipt, suppression management).
---

# SendGrid — transactional email

SendGrid (now part of Twilio) is the dominant transactional email platform for AutoFlow's SMB segment. Use it for **one-to-one, system-generated email** — order confirmations, password resets, payment receipts, alert notifications — not for newsletters or campaigns (those belong in Mailchimp or Klaviyo).

The "transactional vs marketing" split matters: transactional email is timely, expected, exempt from CAN-SPAM unsubscribe rules, and goes through SendGrid's hot-path queue. Marketing email needs unsubscribe links, list management, and goes through the slower campaign infrastructure. Routing the wrong one through the wrong service damages domain reputation.

## When to reach for this skill

- **Order confirmation** — Stripe checkout succeeded → confirmation email with line items + receipt.
- **Password reset** — user requested → time-bound link.
- **Payment receipt** — Stripe `invoice.paid` → branded HTML receipt.
- **Alert notification** — system event (failed payment, deploy succeeded, anomaly detected) → email to a workspace admin.
- **Invoice send** — QBO invoice ready → email PDF attached.
- **Calendar invite** — Calendly booking → confirmation with .ics attached.
- **DocuSign envelope ready** → custom notification (if not using DocuSign's native send).

## Authentication

SendGrid uses a single API key per integration:

```
Authorization: Bearer <sendgrid-api-key>
```

Keys can be **scoped** at creation time — for AutoFlow's pattern, create a key with `mail.send` + `template_engine.read` permissions only. Avoid the full-access key.

Base URL: `https://api.sendgrid.com/v3/`

EU data residency: `https://api.eu.sendgrid.com/v3/` for customers requiring it. Capture the region on the AutoFlow connection record at install time.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Mail Send | `/mail/send` | The transactional send endpoint |
| Dynamic Templates | `/templates/{template_id}` | Reusable HTML with merge vars |
| Sender Authentication | `/whitelabel/domains` | DKIM + custom domain setup |
| Suppressions | `/suppression/bounces`, `/suppression/spam_reports`, `/suppression/unsubscribes` | Per-recipient send-blocklists |
| Stats | `/stats?aggregated_by=day&start_date=...` | Send + open + click reports |
| Event Webhook | `/user/webhooks/event/settings` | Push delivery events to AutoFlow |
| Inbound Parse | `/user/webhooks/parse/settings` | Receive emails as webhook POSTs |
| Single Sends | `/marketing/singlesends` | One-off broadcast (marketing surface — usually skipped from this skill) |

## Common AutoFlow workflows

### 1. Stripe checkout completed → order confirmation

```
Stripe webhook checkout.session.completed → Routine fires →
  1. Look up the order line items (from session.line_items or
     a HubSpot deal reference)
  2. POST /mail/send:
       from: { email: "orders@<customer-domain>", name: "Acme Store" }
       to:   [{ email: session.customer_details.email,
                name:  session.customer_details.name }]
       template_id: "<dynamic-template-id>"
       dynamic_template_data:
         order_id, total, currency, items[], shipping_address,
         tracking_url (will be filled in later by ShipStation)
       custom_args: { routine_run_id, hubspot_deal_id }
  3. Status 202 = queued. Confirm via Event Webhook (workflow 4) that
     it actually delivered.
```

### 2. Password reset → time-bound link

```
User clicks "forgot password" → Routine fires →
  1. Generate a single-use token, store it with TTL of 1h
  2. POST /mail/send:
       template_id: "<password-reset-template>"
       dynamic_template_data:
         reset_url: "https://app.example.com/reset?token={token}",
         expires_in: "1 hour"
       categories: ["password-reset"]  // for stats grouping
  3. Token is consumed on the reset endpoint or expires; never reissue
     the same token for security.
```

### 3. QuickBooks invoice → emailed PDF

```
QBO invoice routine completes → Routine fires →
  1. GET QBO /invoice/{id}/pdf to fetch the PDF bytes
  2. POST /mail/send:
       to: customer.email
       subject: "Invoice {invoice_number} from {company_name}"
       template_id: "<invoice-send-template>"
       attachments: [{
         content: base64(pdf_bytes),
         filename: "invoice-{number}.pdf",
         type: "application/pdf",
         disposition: "attachment"
       }]
       custom_args: { qbo_invoice_id }
  3. Log a HubSpot timeline event: "Invoice {number} sent to {customer}".
```

### 4. Delivery event tracking via Event Webhook

```
SendGrid Event Webhook POSTs an array of events → AutoFlow Routine fires →
  1. Verify the X-Twilio-Email-Event-Webhook-Signature
     (Ed25519 signature; SendGrid SDK has a verifier helper)
  2. For each event in the array (delivered / opened / clicked /
     bounced / dropped / spamreport / unsubscribe):
       Read sg_event_id (idempotency key), sg_message_id, custom_args
       Update internal "send status" record
       If bounced or dropped: add to AutoFlow's suppression table for
       the workspace + alert the admin
       If spamreport: page on-call — domain reputation hit
  3. Aggregate stats to the reporting table for weekly send-health review.
```

## Idempotency

`/mail/send` does NOT support idempotency keys. AutoFlow routines must dedupe upstream — store a `sent_at` timestamp on the source record (e.g. `stripe_session.confirmation_email_sent_at`) and check before re-firing. The Event Webhook's `sg_event_id` is the dedupe key for inbound events.

## Suppressions

SendGrid maintains per-account suppression lists (bounces, spam reports, unsubscribes). Mail to a suppressed address is **silently dropped** — you get a successful 202 from `/mail/send` but no email is delivered.

Before any new SMB workspace goes live, check the suppression lists and surface them to the customer. Common surprise: an address that bounced six months ago for a transient reason still on the list.

## Sender authentication

The `from` address **must be on an authenticated domain** (SPF + DKIM + DMARC set up via SendGrid's `/whitelabel/domains` flow). Without that:
- Gmail/Outlook reject or junk the mail
- SendGrid's free tier limits get tight
- Domain reputation tanks

AutoFlow's onboarding flow should walk new customers through domain authentication before they can send a single transactional email through the integration.

## Rate limits

- **3,000 requests/sec** on Pro plans; **100/sec** on lower tiers.
- 429 returns `Retry-After`.
- For bulk sends (>1,000 in a short window), use the batched `personalizations` array — one API call can send to up to 1,000 distinct recipients with per-recipient merge data.

## What this skill does NOT cover

- **SendGrid Marketing Campaigns** — newsletters / drip / broadcast. That surface is in this skill briefly (Single Sends), but for actual marketing email use Mailchimp / Klaviyo. SendGrid Marketing exists but isn't where AutoFlow customers usually run their marketing program.
- **Inbound Parse beyond webhook receipt** — full inbound email handling (threading, MIME parsing, attachments) belongs in a dedicated email-handling layer.
- **Twilio MessagingService email channel** — Twilio's newer unified messaging product overlaps; rare on the SMB path right now.

## References

- API: https://docs.sendgrid.com/api-reference
- Mail Send: https://docs.sendgrid.com/api-reference/mail-send/mail-send
- Dynamic Templates: https://docs.sendgrid.com/ui/sending-email/how-to-send-email-with-dynamic-transactional-templates
- Event Webhook: https://docs.sendgrid.com/for-developers/tracking-events/event
- Sender authentication: https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; from-domain captured separately)
