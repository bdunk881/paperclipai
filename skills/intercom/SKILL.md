---
name: intercom
description: Use this skill when an AutoFlow agent needs to read or write conversation / contact data in Intercom — find a contact, open or reply to a conversation, attach a note, fire a tag-based routine (CSM handoff, churn risk, in-app feature flag), or react to webhook events for new conversations, replies, or attribute changes. Covers Intercom's API v2.x with OAuth + access-token auth, the Contact / Company / Conversation / Article / Tag model, and the workflow shape AutoFlow customers reach for (chat opens → CRM enrichment, support reply → CRM activity log, tag added → downstream routine).
---

# Intercom — in-product messaging & support

Intercom is the dominant messaging + support platform for AutoFlow's SMB segment running a SaaS / product business. It lives inside the customer's app as the chat widget, captures product-qualified leads, and runs the support inbox. Customers reach for it for the "talk to your users where they are" surface.

## When to reach for this skill

- **Chat opened** → enrich the contact in HubSpot, post a heads-up to the rep's Slack DM.
- **Conversation reply** → log as an activity on the HubSpot contact for full timeline.
- **Tag added** (e.g. "churn-risk", "expansion-opportunity") → fire a downstream routine.
- **Custom attribute changed** (e.g. plan tier, last-login) → react in CRM, email, or onboarding flows.
- **Conversation closed** → log resolution stats, fire CSAT.
- **Lead from chat** → upsert as HubSpot contact + Mailchimp subscriber + start nurture sequence.

## Authentication

Two flavors:

- **Access Token** — single-workspace, simplest. From Developer Hub, scoped per app. Use this for AutoFlow's per-workspace integrations where the customer connects their own Intercom workspace.

  ```
  Authorization: Bearer <intercom-access-token>
  Intercom-Version: 2.11
  ```

- **OAuth 2** — multi-workspace SaaS pattern. Standard authorization-code flow; the issued access token is long-lived.

**Always set `Intercom-Version` header** — Intercom versions its API per-call rather than per-instance. Pin to a known version (currently `2.11`); upgrade deliberately when adopting new features. Missing the header = unstable behavior (you get whatever the default is at request time).

Base URL: `https://api.intercom.io/`

EU + AU regions: `https://api.eu.intercom.io/` and `https://api.au.intercom.io/`. Customer's data-residency choice determines this — capture at install time.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Contact | `/contacts/{id}` | The end-user (visitor or signed-in user) |
| Company | `/companies/{id}` | Account-level record |
| Conversation | `/conversations/{id}` | The threaded message exchange |
| Conversation Parts | embedded in conversation | Individual messages, notes, assignments |
| Reply | `/conversations/{id}/reply` | Add a public or admin reply |
| Note | `/conversations/{id}/parts` (type=note) | Private internal note |
| Admin | `/admins/{id}` | Teammate (support agent) record |
| Tag | `/tags` | Workflow labels |
| Article | `/articles/{id}` | Help Center knowledge-base article |
| Data Attribute | `/data_attributes` | Schema (custom attributes on Contact / Company) |
| Event | `/events` | Behavioral event (one-shot, for segmentation) |
| Segment | `/segments/{id}` | Saved query for filtering contacts |

## Common AutoFlow workflows

### 1. Chat opened → enrich contact in HubSpot

```
Intercom webhook conversation.user.created → Routine fires →
  1. GET /contacts/{contact_id} for email + custom attributes
  2. PUT HubSpot /crm/v3/objects/contacts/{email}?idProperty=email
       merge intercom.custom_attributes → HubSpot props
       set lifecyclestage=lead if new
  3. (Optional) POST a Slack DM to the assigned CSM:
       "{contact.name} ({contact.email}) opened a chat about: {first message}"
```

### 2. Tag-based churn routine

```
Intercom webhook contact.tag.created (tag.name = "churn-risk") → Routine fires →
  1. GET /contacts/{id} for the customer's signals (plan, MRR, last login)
  2. POST /conversations: open a proactive support conversation
     "Hi — noticed things have been quiet. Anything we can help with?"
  3. PATCH HubSpot deal/contact: lifecyclestage=at-risk
  4. POST to #customer-success Slack channel for human follow-up.
```

### 3. Reply → CRM activity log

```
Intercom webhook conversation.admin.replied → Routine fires →
  1. GET /conversations/{id} for body + admin who replied
  2. POST HubSpot timeline event on the contact:
       eventTypeId: "intercom_reply"
       tokens: { admin_name, body_preview, conversation_url }
  3. Increment a custom HubSpot prop "total_support_touches" for cohort analysis.
```

### 4. Conversation closed → CSAT + dashboard

```
Intercom webhook conversation.closed → Routine fires →
  1. GET /conversations/{id} for resolution_time, first_response_time, tags
  2. Native Intercom CSAT (if enabled) auto-fires; AutoFlow doesn't need
     to trigger it
  3. Write to the workspace reporting table:
       (conversation_id, contact_id, response_time_min, resolution_time_min,
        tags, admin_id) for weekly support metrics
  4. Optionally: tag "support-closed-this-week" to feed a Mailchimp
     follow-up campaign.
```

## Search syntax

Intercom Search API is a JSON DSL (not a query string). Common shape:

```
POST /contacts/search
body:
  query:
    operator: AND
    value:
      - { field: "role", operator: "=", value: "user" }
      - { field: "custom_attributes.plan", operator: "=", value: "pro" }
      - { field: "last_seen_at", operator: ">", value: <unix_ts> }
  pagination:
    per_page: 50
```

Always pass `Intercom-Version` here too.

## Idempotency

Intercom supports `Idempotency-Key` on POST `/conversations`, POST `/events`, and a few other endpoints (docs are explicit per-endpoint). Use it on any write that has a clear "logical operation" — e.g. `routine-run-{run_id}-chat-open`.

For contact upserts, use the `external_id` field as your natural unique key; `PUT /contacts?external_id=...` upserts. Set `external_id` to your CRM ID (e.g. HubSpot contact UUID) at first contact-create so subsequent syncs target the right record.

## Webhooks

Subscribe via Developer Hub UI or the API:

```
POST /subscriptions
body:
  service_type: "web"
  url: "https://autoflow.example/webhooks/intercom/{workspace_id}"
  topics:
    - "conversation.user.created"
    - "conversation.admin.replied"
    - "conversation.closed"
    - "contact.tag.created"
    - "contact.tag.deleted"
```

Signature verification: `X-Hub-Signature` (HMAC-SHA1 of body with the client secret). **Verify before processing.**

Replay safety: Intercom retries on 5xx for up to 24h with exponential backoff. Dedupe by the `id` field on the topic payload.

## Rate limits

- **1,000 requests/minute** per workspace (Plus/Premium) / **500** (Pro).
- 429 includes `X-RateLimit-Reset` (Unix seconds). Honor it.
- Bulk endpoints (`/contacts/search`, `/conversations/list`) page at 150 max; iterate.

## What this skill does NOT cover

- **Intercom Surveys** (its own product) — overlaps with Mailchimp/Typeform; pick one and route survey events from there.
- **Intercom Fin** (their AI agent) — internal to Intercom; AutoFlow doesn't drive it.
- **Help Center / Articles** authoring — the Article endpoints exist but customers usually manage these in Intercom's UI, not via AutoFlow.
- **Outbound campaigns / series** — those run inside Intercom; AutoFlow can fire events that target them, not the other way around.

## References

- API: https://developers.intercom.com/intercom-api-reference/reference
- Versioning: https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis/api-versioning
- Webhooks: https://developers.intercom.com/intercom-api-reference/reference/webhooks
- Search syntax: https://developers.intercom.com/intercom-api-reference/reference/search-contacts
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key; region captured at install)
