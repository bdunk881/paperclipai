---
name: typeform
description: Use this skill when an AutoFlow agent needs to react to or read data from a Typeform — list submissions on a form, react to a new response via webhook (upsert CRM contact, route to a sequence, score the response), pull historical responses for analysis, or programmatically create new forms. Covers Typeform's personal-token + OAuth 2 auth, the Forms / Responses / Webhooks model, the response-payload shape with field ID mapping, and the workflow shape AutoFlow customers reach for (form submitted → CRM contact + qualification, NPS response → segmentation tag, contact form → support ticket).
---

# Typeform — forms, surveys, intake

Typeform is the dominant survey + intake form platform for AutoFlow's SMB customers when they need a single-purpose, branded form (lead capture, NPS survey, support intake, event RSVP). It's chosen over Google Forms when brand polish matters and over Jotform when conversational flow matters.

## When to reach for this skill

- **Lead-capture form submitted** → upsert HubSpot contact + Mailchimp/Klaviyo subscriber + start a nurture sequence.
- **NPS or CSAT survey** → tag the responder for segmentation, flag promoters for testimonial outreach, escalate detractors.
- **Support intake form** → open a Zendesk/Intercom ticket with the captured context pre-populated.
- **Application / qualification form** → score the response, route high-scoring leads to sales, low-scoring to nurture.
- **Event RSVP** → add to Calendly slot, push confirmation SMS via Twilio.
- **Periodic export** — pull all responses for a form into a reporting table or BigQuery.

## Authentication

Two paths:

- **Personal Access Token** — single-user, simplest. Created in account settings. Use this for AutoFlow's per-workspace integrations where the customer connects their own Typeform account.

  ```
  Authorization: Bearer <typeform-personal-token>
  ```

- **OAuth 2** — multi-account SaaS pattern. Authorization-code flow; refresh tokens are long-lived.

Base URL: `https://api.typeform.com/`

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Forms | `/forms` | List + create + update forms |
| Single Form | `/forms/{form_id}` | Definition: fields, logic, design, settings |
| Responses | `/forms/{form_id}/responses` | All submissions to a form |
| Webhooks | `/forms/{form_id}/webhooks/{tag}` | Manage push subscriptions per form |
| Themes | `/themes/{id}` | Brand styling (rarely touched programmatically) |
| Workspaces | `/workspaces` | Folders organizing the customer's forms |
| Images / Videos | `/images/{id}` | Media assets used in form questions |

### Response payload shape

Each response in `/responses` looks like:

```json
{
  "response_id": "abcdef123456",
  "submitted_at": "2026-05-28T10:00:00Z",
  "hidden": { "utm_source": "google", "lead_id": "..." },
  "answers": [
    { "field": { "id": "f_abc123", "type": "email", "ref": "email" },
      "type": "email", "email": "buyer@example.com" },
    { "field": { "id": "f_def456", "type": "short_text", "ref": "first_name" },
      "type": "text", "text": "Maya" }
  ]
}
```

The **`ref`** is the developer-set field name (configured in the form designer); the **`id`** is the Typeform-generated UUID. Most AutoFlow integrations key on `ref` because it survives field reordering and the developer has control over its value.

Always look up answers by `ref` (semantic) not `id` (opaque). If a customer's form doesn't set refs, ask them to set them before wiring AutoFlow.

## Common AutoFlow workflows

### 1. Lead form → CRM + sequence

```
Typeform webhook on form_response → Routine fires →
  1. Verify webhook signature (see Webhooks)
  2. Parse answers by ref to a flat object:
     { email: ..., first_name: ..., company: ..., budget: ..., utm_source: ... }
  3. HubSpot PUT /crm/v3/objects/contacts/{email}?idProperty=email
       with the parsed fields → matched HubSpot properties
       set lifecyclestage=lead, source=typeform_form_name
  4. Compute a lead score from budget + company size + utm_source
  5. If score >= threshold:
       Enroll in "sales-ready" sequence (Mailchimp or HubSpot Workflows)
       Post to #sales-leads Slack channel
     Else:
       Enroll in "nurture" sequence
```

### 2. NPS / CSAT response → segmentation + escalation

```
Typeform webhook → Routine fires →
  1. Parse the NPS score answer (0-10)
  2. Look up the responder in HubSpot by email
  3. PATCH contact: { properties: { nps_latest_score: N, nps_last_response_at: now } }
  4. If score >= 9 (promoter):
       Tag in Mailchimp/Klaviyo with "promoter"
       Optionally fire a testimonial-request follow-up email
  5. If score <= 6 (detractor):
       Open a Zendesk ticket assigned to Customer Success
       Post a Slack alert to #cs-detractors
  6. Write to the workspace's NPS reporting table for the dashboard.
```

### 3. Support intake form → Zendesk ticket

```
Typeform webhook → Routine fires →
  1. Parse answers: { email, issue_category, severity, description, attachments[] }
  2. POST Zendesk /tickets:
       subject: "[Typeform intake] {issue_category}"
       comment.body: description + structured hidden field metadata
       requester: { email, name }
       tags: [issue_category, severity-level]
       group_id: routed by issue_category
  3. POST Slack alert if severity == "critical".
```

### 4. Historical export for analysis

```
Cron routine weekly →
  1. GET /forms/{form_id}/responses?page_size=1000&since={last_run_at}
     (paginate by token — Typeform returns `page_count` + `total_items`;
      use `before` cursor for chronological iteration)
  2. Normalize each response.answers[] into a flat row by ref
  3. Upsert to the reporting table (Postgres, BigQuery, sheet) keyed by response_id
  4. Mark the cron's last_run_at to the latest submitted_at observed.
```

## Webhooks

Configured per-form via the API:

```
PUT /forms/{form_id}/webhooks/{your-tag}
body:
  url: "https://autoflow.example/webhooks/typeform/{workspace_id}/{form_id}"
  enabled: true
  secret: "<random-per-webhook-secret>"
  verify_ssl: true
```

The `tag` is your label for the webhook (you choose it). One form can have multiple tagged webhooks for fan-out.

Signature verification: `Typeform-Signature` header carries a `sha256=<base64>` hash of the body using the per-webhook secret. **Verify before processing.**

Replay safety: Typeform retries on 5xx for ~24h. Dedupe by `response_id` (UUID, stable per submission).

## Rate limits

- **2 requests/sec** per personal token (steady-state).
- **Burst budget** allows short spikes.
- 429 returns `Retry-After`.
- For large exports, use the `responses` endpoint with proper cursor pagination — there's no separate bulk export.

## Hidden fields

Typeform supports **hidden fields** (URL-injected query params). The form URL `https://form.typeform.com/to/abc123?lead_id=xyz&utm_source=google` makes `lead_id` and `utm_source` available in `response.hidden` without being visible to the responder.

Use hidden fields for:
- Correlating a response back to an AutoFlow routine run (`?routine_run_id=...`)
- UTM tracking from marketing campaigns
- Pre-filling known information for authenticated users (avoid asking again)

## What this skill does NOT cover

- **Typeform Quiz scoring** — the in-product score is exposed in the response payload as `calculated`, but scoring logic lives in Typeform's UI. Read it; don't rewrite it.
- **Typeform's Create API** — programmatic form creation is supported but most SMBs build forms in the UI. Author its own skill section when a customer needs dynamic forms.
- **Multi-language support** — Typeform supports translations; AutoFlow routines just read whichever language the response came in.
- **Theme customization** — managed in Typeform's UI by the customer's marketing team.

## References

- API: https://www.typeform.com/developers/
- Responses API: https://www.typeform.com/developers/responses/
- Webhooks: https://www.typeform.com/developers/webhooks/
- Webhook signature: https://www.typeform.com/developers/webhooks/secure-your-webhooks/
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce; secret-per-webhook stored separately from the auth token)
