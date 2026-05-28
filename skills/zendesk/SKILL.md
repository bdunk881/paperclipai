---
name: zendesk
description: Use this skill when an AutoFlow agent needs to read or write support data in Zendesk — create / update / search tickets, add private internal notes or public replies, look up requesters, assign tickets to groups or agents, react to ticket events with downstream routines (post to Slack, create a HubSpot deal, draft a refund in Stripe). Covers Zendesk Support REST API v2, OAuth + API-token auth, the Ticket / Requester / Organization / Group / Macro model, and the workflow shape AutoFlow customers reach for (new ticket → triage routine, escalation → manager handoff, resolution → CSAT survey).
---

# Zendesk Support — customer support ticketing

Zendesk Support is the dominant ticketing platform for AutoFlow's SMB segment past ~25 employees (Help Scout / Intercom dominate below that). It's the source of truth for customer issues and the trigger surface for most support automation.

## When to reach for this skill

- **New ticket** → triage routine (route to group by tag/subject, set priority, AI-draft reply).
- **Ticket escalation** → notify a manager in Slack, open a HubSpot deal if it's an existing customer, pull recent invoices from QuickBooks for context.
- **Bug-class ticket** → mirror to Linear/Jira as a defect; link the two for traceability.
- **Refund request** → look up the Stripe charge, draft a refund for human approval.
- **Resolution** → trigger CSAT survey, log to a reporting dashboard.
- **Stale tickets** → daily cron sweeping open tickets >7d for follow-up reminders.

## Authentication

Two paths, both at the same base URL:

- **API Token** — simplest. Created in Admin Center; combined with an email in Basic Auth:

  ```
  Authorization: Basic base64(<email>/token:<api-token>)
  ```

- **OAuth 2** — required for multi-tenant SaaS partners (AutoFlow's preferred path for new connections). Standard authorization-code flow with refresh tokens that **don't expire by default**.

Subdomain matters: every Zendesk instance is `{subdomain}.zendesk.com` and that's also the API base — `https://{subdomain}.zendesk.com/api/v2/`. Capture the subdomain at connection time.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Ticket | `/api/v2/tickets/{id}` | The support request |
| Ticket Comment | `/api/v2/tickets/{id}/comments` | Reply thread (public + private) |
| Audit | `/api/v2/tickets/{id}/audits` | Every change with author + before/after |
| User (Requester) | `/api/v2/users/{id}` | Customer record |
| Organization | `/api/v2/organizations/{id}` | Company the user belongs to |
| Group | `/api/v2/groups/{id}` | Routing destination (e.g. "Billing", "Tier 2") |
| Macro | `/api/v2/macros/{id}` | Reusable action template |
| Search | `/api/v2/search?query=...` | Cross-resource search with Zendesk query syntax |
| Trigger | `/api/v2/triggers/{id}` | In-app automation rules (rarely written by agents) |
| Custom Field | `/api/v2/ticket_fields` | Schema — needed to populate custom fields by ID |

## Common AutoFlow workflows

### 1. New ticket → triage routine

```
Zendesk webhook ticket.created → Routine fires →
  1. GET /tickets/{id}?include=users,groups
  2. Classify by subject + body via an LLM step (use the existing tier
     router; "support" usually wants the lite tier for speed)
  3. PUT /tickets/{id} with:
       priority: derived from severity classification
       group_id: routed by category (Billing, Technical, Sales-handoff)
       tags: append AI-derived tags
  4. POST /tickets/{id}/comments (private internal note) with the
     classification rationale so a human sees why it landed where it did.
```

### 2. Refund request → Stripe lookup + draft refund

```
Triggered by a custom Zendesk tag "refund-request" (set by a triage
or a macro) → Routine fires →
  1. GET /tickets/{id}/comments — pull the requester's account email
  2. Search Stripe: GET /v1/customers?email=...
  3. List recent charges, find the one the customer's complaining about
  4. Create a Stripe refund in TEST MODE (or draft a refund object in
     a metadata field for human approval)
  5. POST /tickets/{id}/comments (private internal note):
       "Found Stripe charge {id} for ${amount} on {date}.
        Draft refund {refund_id} created — needs Tier 2 approval."
  6. Optionally PUT /tickets/{id} with assignee_id = "Refund Approvers" group.
```

### 3. Bug ticket → mirror to Linear

```
Ticket tagged "bug" → Routine fires →
  1. Search Linear for existing issue: title contains the ticket subject
  2. If none, create a Linear issue:
       title: "[Customer] {ticket.subject}"
       description: ticket.body + link back to Zendesk ticket
       team: "Engineering Triage"
  3. PUT Zendesk ticket: set custom field "Linear Issue" to the new issue URL
  4. POST internal note: "Mirrored to Linear: {linear_url}"
  5. Subscribe Zendesk to webhook updates on the Linear issue so
     resolution closes both.
```

### 4. Resolution → CSAT + dashboard log

```
Webhook ticket.status.changed (to "solved") → Routine fires →
  1. GET /tickets/{id}?include=metric_sets
  2. POST CSAT survey via the platform of choice (Mailchimp, native
     Zendesk CSAT, etc.)
  3. Write to the workspace reporting table:
       (ticket_id, requester_email, resolution_time_hours, group, tags)
     for the weekly support-metrics dashboard.
```

## Search syntax

Zendesk's search query is its own DSL. Most common patterns:

```
type:ticket status:open priority:high
type:ticket requester:user@example.com created>2026-05-01
type:ticket tags:refund-request status<solved
type:user organization:"Acme Corp"
```

Pagination: `?page=N&per_page=100` (or cursor-based for `/incremental/`). For large historical pulls, use **Incremental Export** (`/incremental/tickets.json?start_time=`) — it's designed for replication and respects rate limits gently.

## Idempotency

Zendesk doesn't expose an Idempotency-Key header. For ticket creation from external sources (e.g. converting an email forwarded by the customer), AutoFlow routines should set the `external_id` field — Zendesk treats it as a unique-by-account index and lets you upsert by it via the `?external_id=...` query param.

## Webhooks

Manage via Admin Center UI or the API:

```
POST /api/v2/webhooks
body:
  webhook:
    name: "AutoFlow workspace {workspace_id}"
    endpoint: "https://autoflow.example/webhooks/zendesk/{workspace_id}"
    http_method: POST
    request_format: json
    subscriptions: ["zen:event-type:ticket.created", "zen:event-type:ticket.tag_added", ...]
```

Signature verification: `X-Zendesk-Webhook-Signature` (HMAC-SHA256) and `X-Zendesk-Webhook-Signature-Timestamp` together. **Verify before processing** — webhook URLs leak via screenshots and audit logs.

Replay safety: Zendesk delivers reliably; on handler 5xx it retries with exponential backoff for ~24h. Make handlers idempotent.

## Rate limits

- **700 requests/min** per account (Plus tier) / **400** (Suite Team) / **200** (Support Team).
- 429 returns `Retry-After`. Heavy poll routines (CSAT export, incremental sync) should run off-peak.
- Bulk endpoints exist for ticket update + user create — use them when touching >50 records.

## What this skill does NOT cover

- **Zendesk Chat / Talk** (live chat, voice) — separate APIs with different auth. Author its own skill when needed.
- **Zendesk Sell** (CRM) — distinct product; not on AutoFlow's common path (customers usually have HubSpot).
- **Help Center / Guide** (knowledge base) — different endpoints; if a customer needs AI-drafted KB articles, author its own skill.
- **Sandbox provisioning** — done in Admin Center UI by the customer's ops lead.

## References

- API: https://developer.zendesk.com/api-reference/ticketing/introduction/
- Webhooks: https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/
- Search syntax: https://support.zendesk.com/hc/en-us/articles/4408886879258
- Incremental Export: https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key; subdomain captured at install)
