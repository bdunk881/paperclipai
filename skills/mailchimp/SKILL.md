---
name: mailchimp
description: Use this skill when an AutoFlow agent needs to manage email-marketing audiences and campaigns in Mailchimp — add or update subscribers, trigger transactional sends, enroll contacts in journeys, react to campaign events (open/click/unsubscribe), sync segments back to the CRM. Covers Mailchimp's API-key + datacenter prefix auth, the Audiences / Lists / Members / Campaigns / Journeys / Tags model, idempotent member upsert, and the workflow shape AutoFlow customers reach for (lead → list + journey, purchase → tag for segmentation, unsubscribe → CRM lifecycle update).
---

# Mailchimp — email marketing & journeys

Mailchimp is the most common email marketing platform for AutoFlow's SMB segment, especially product / e-commerce / services businesses that aren't on HubSpot Marketing Hub. It sits next to the CRM (HubSpot) and the commerce store (Shopify), often receiving leads from both.

## When to reach for this skill

- **New lead** (from Calendly, Shopify, HubSpot form) → add to a list + enroll in a journey.
- **Purchase event** → tag the subscriber for behavioral segmentation ("bought-pro-plan", "first-time-buyer").
- **Unsubscribe / bounce** → update HubSpot lifecycle stage + suppress from future routine sends.
- **Campaign sent** → log to a reporting dashboard or write a recap to Slack.
- **Audience cleanup** → periodic dedup, archive inactive subscribers, sync between lists.

## Authentication

Mailchimp uses **API keys** with a datacenter suffix that tells you which regional API to call:

```
Authorization: Bearer <mailchimp-api-key>
```

The key looks like `abcdef123456789-us21` — the `-us21` is the datacenter. Base URL is derived from it:

```
https://us21.api.mailchimp.com/3.0/
```

**Always parse the key to find the datacenter first** — there's no global API endpoint. AutoFlow stores both the raw key and the parsed datacenter on the connection record.

For multi-tenant SaaS apps Mailchimp also supports OAuth 2.0 (`/oauth2/authorize` flow); the same datacenter parsing rule applies to the resulting token.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Audiences (Lists) | `/lists/{list_id}` | The mailing list itself |
| List Members | `/lists/{list_id}/members/{subscriber_hash}` | A subscriber on a list |
| Member Tags | `/lists/{list_id}/members/{hash}/tags` | Behavioral labels for segmentation |
| Segments | `/lists/{list_id}/segments` | Saved subscriber queries |
| Campaigns | `/campaigns/{campaign_id}` | A one-off broadcast send |
| Campaign Content | `/campaigns/{id}/content` | HTML/text body editor |
| Reports | `/reports/{campaign_id}` | Opens/clicks/bounces/unsubs |
| Automations / Journeys | `/customer-journeys/journeys/{journey_id}/steps/{step_id}/actions/trigger` | Trigger a contact into a step |
| Events (Customer-data API) | `/lists/{list_id}/members/{hash}/events` | Log behavior events for segmentation |

### Subscriber hash

The member URL takes a **subscriber hash** — the **lowercased MD5 of the email address**. This is the API's idempotency key: `PUT /members/{hash}` upserts. AutoFlow agents should compute the hash once at the call site rather than calling `GET .../members?email=...` first.

```
hash = md5(email.lower())
```

## Common AutoFlow workflows

### 1. New lead → list + journey

```
Calendly booking webhook or HubSpot form submission → Routine fires →
  1. Compute subscriber_hash = md5(email.lower())
  2. PUT /lists/{list_id}/members/{hash}
       body: { email_address, status_if_new: "subscribed",
               merge_fields: { FNAME, LNAME, ... } }
  3. POST /lists/{list_id}/members/{hash}/tags
       body: { tags: [{ name: "from-calendly-demo", status: "active" }] }
  4. POST /customer-journeys/.../actions/trigger
       to drop them into the welcome / nurture journey
```

### 2. Shopify purchase → behavioral tag for segmentation

```
Shopify orders/paid webhook → Routine fires →
  1. Compute the subscriber hash for order.email
  2. POST /lists/{list_id}/members/{hash}/tags
       body: { tags: [{ name: "bought-{product-handle}", status: "active" },
                      { name: "lifetime-value-tier-2", status: "active" }] }
  3. POST /lists/{list_id}/members/{hash}/events
       body: { name: "purchase", properties: { amount, currency, product_id } }
       (Powers Mailchimp's "spent in last 30 days" segmentation.)
```

### 3. Unsubscribe → HubSpot lifecycle update

```
Mailchimp `unsubscribe` webhook → Routine fires →
  1. Verify the webhook came from Mailchimp (see Webhooks below)
  2. HubSpot PATCH /crm/v3/objects/contacts/{email}?idProperty=email
       body: { properties: { hs_email_optout: "true",
                             lifecyclestage: "subscriber" } }
  3. (Optional) Log to a workspace audit channel — high-value contact churn
     is worth a human eye.
```

### 4. Campaign sent → Slack recap

```
Cron routine 1h after campaign send_time →
  1. GET /reports/{campaign_id} for opens/clicks/bounces/unsubs
  2. Format a Slack message:
       "Campaign 'Spring Sale': 14,300 sent, 23% open, 4% click, 12 unsubs"
  3. POST to the workspace's #marketing Slack channel.
```

## Idempotency

The `PUT` upsert-by-subscriber-hash pattern is naturally idempotent. For other writes (campaign create, tag add) Mailchimp doesn't expose an idempotency-key header — AutoFlow routines should check-then-create using the resource's natural unique field (campaign title, tag name) before POSTing.

## Webhooks

Mailchimp's webhooks fire on subscribe / unsubscribe / profile / cleaned / upemail / campaign events. Configure per-list:

```
POST /lists/{list_id}/webhooks
body:
  url: "https://autoflow.example/webhooks/mailchimp/{workspace_id}/{list_id}"
  events: { subscribe: true, unsubscribe: true, profile: true, cleaned: true }
  sources: { user: true, admin: true, api: true }
```

Mailchimp's webhook **does not include a signature** by default. The recommended verification is **inbound-IP allowlisting** combined with a per-list secret in the URL path (e.g. `.../webhooks/mailchimp/{secret_token}`). Ingest pattern: `src/integrations/` already has the secret-in-path pattern.

Replay safety: Mailchimp delivers exactly-once in normal operation, but transient redelivery happens. Dedupe by `(list_id, email, type, fired_at)` on AutoFlow's side.

## Rate limits

- **10 concurrent connections** per API key. The limiter is concurrency, not rate — sequential requests are effectively unlimited.
- Batch operations (`/batches`) handle bulk subscriber operations asynchronously — submit a job, poll for completion, useful for >100 ops.

## What this skill does NOT cover

- **Mandrill** (Mailchimp Transactional) — a separate product with a different auth model. Useful for transactional email; skill should be its own file when authored.
- **Mailchimp Sites / Domains** — website builder, not on AutoFlow's path.
- **SMS** — Mailchimp's SMS product is shallow; for SMS marketing reach for a dedicated skill (Twilio, Klaviyo SMS).

## References

- API: https://mailchimp.com/developer/marketing/api/
- Webhooks: https://mailchimp.com/developer/marketing/guides/sync-audience-with-webhooks/
- Customer Journeys API: https://mailchimp.com/developer/marketing/api/customer-journeys-journeys/
- Subscriber hash: https://mailchimp.com/developer/marketing/docs/methods/#md5-hashing
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store pattern; parse datacenter from key)
