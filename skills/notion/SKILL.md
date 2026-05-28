---
name: notion
description: Use this skill when an AutoFlow agent needs to read or write knowledge data in Notion — create pages from a template (meeting notes from a Calendly booking, onboarding doc from a new-hire trigger), append blocks to a running doc, query databases (project tracker, customer roster), or maintain a single-source-of-truth knowledge graph linking customers to deals to meetings. Covers Notion's Internal Integration token auth, the Page / Block / Database / Property model, the awkward block-hierarchy traversal, and the workflow shape AutoFlow customers reach for (booking → meeting notes page, ticket → KB article, customer signup → CRM database row).
---

# Notion — knowledge & document workspace

Notion is the most common all-in-one workspace tool for AutoFlow's SMB segment. It absorbs the documentation, project management, and lightweight CRM use cases that would otherwise be split across Confluence + Asana + Airtable. Agents touching Notion are usually building a single-source-of-truth knowledge graph or producing structured artifacts on a trigger.

## When to reach for this skill

- **Booking → meeting notes page** — Calendly invitee.created → create a Notion page in the "Meetings" database with attendees, agenda template, link back to the calendar event.
- **Ticket → KB article draft** — a resolved Zendesk ticket about a recurring issue → draft a new help article in the Notion KB for human review + publish.
- **Customer signup → CRM database row** — Stripe customer.created → insert a row in the customer Notion database (for teams using Notion as lightweight CRM instead of HubSpot).
- **Periodic recap** — week-end summary of routine activity → append a block to the "Weekly Operations" running doc.
- **Cross-tool join** — when a HubSpot deal closes, surface a link to the Notion project page that's tracking the implementation.

## Authentication

Notion uses **Internal Integration tokens** for the AutoFlow pattern:

```
Authorization: Bearer secret_<token>
Notion-Version: 2022-06-28
Content-Type: application/json
```

`Notion-Version` is required — always set it. Notion versions per-call, so missing the header gets you the default at request time (unstable).

The integration must be **shared** with specific pages or databases in Notion's UI (right-click → "Connect to" → AutoFlow's integration). Without that explicit share, the API returns 404 for those resources — agents will see "page doesn't exist" errors and assume they have the wrong ID.

For multi-tenant SaaS, OAuth 2.0 is supported via Public Integrations. The customer goes through Notion's auth flow and AutoFlow stores their access token.

Base URL: `https://api.notion.com/v1/`

## Core API surface

Notion's API is a **block-tree API**, not a flat document API. Every page is a tree of nested blocks. This is the single biggest source of confusion when agents first hit it.

| Resource | Endpoint | What it's for |
|---|---|---|
| Page | `/pages/{page_id}` | A page's metadata (title, properties, parent) |
| Page Children | `/blocks/{page_id}/children` | The page's top-level blocks |
| Block | `/blocks/{block_id}` | A single block (paragraph, heading, list item, etc.) |
| Block Children | `/blocks/{block_id}/children` | A nested block's children (toggles, columns, callouts contain others) |
| Database | `/databases/{database_id}` | The database schema (column definitions) |
| Database Query | `/databases/{database_id}/query` | Filter + sort rows |
| Database Pages | (rows are pages with the database as parent) | Each row IS a Notion page |
| Users | `/users/{user_id}` | Workspace member lookups |
| Search | `/search` | Search across pages + databases the integration can see |

### The block-tree gotcha

A "page" in Notion's UI is one `/pages/{id}` resource for the metadata + a tree of `/blocks/{id}/children` for the content. To pull a page's full content:

```
1. GET /blocks/{page_id}/children → top-level block list
2. For each block where has_children == true,
   GET /blocks/{block_id}/children recursively
3. Stop when all branches return zero children
```

There's no "give me the page text" shortcut. Agents that need full content must traverse. (Read-throughput-heavy routines should cache aggressively.)

## Common AutoFlow workflows

### 1. Calendly booking → Notion meeting page

```
Calendly invitee.created webhook → Routine fires →
  1. POST /pages
       parent: { database_id: "<meetings-db-id>" }
       properties: {
         "Name":       { title: [{ text: { content: "{invitee.name} — Discovery Call" } }] },
         "Date":       { date: { start: invitee.event_start_time } },
         "Attendees":  { multi_select: [{ name: "{invitee.name}" }] },
         "Calendly URL": { url: invitee.scheduled_event.uri }
       }
       children: [
         { heading_2: { rich_text: [{ text: { content: "Agenda" } }] } },
         { bulleted_list_item: { rich_text: [{ text: { content: "Intro" } }] } },
         { bulleted_list_item: { rich_text: [{ text: { content: "Their use case" } }] } },
         { heading_2: { rich_text: [{ text: { content: "Notes" } }] } },
       ]
  2. Optional: post the Notion URL back to Calendly via metadata or send
     to the rep's Slack so they have one click to the prep doc.
```

### 2. Zendesk ticket → Notion KB draft

```
Zendesk ticket resolved with tag "kb-worthy" → Routine fires →
  1. GET /tickets/{id}/comments for the full thread
  2. LLM step: summarize into a help-article format
       (title, problem, solution, related-articles)
  3. POST Notion /pages
       parent: { database_id: "<kb-db-id>" }
       properties: {
         "Title": { title: [{ text: { content: summary.title } }] },
         "Status": { status: { name: "Draft" } },
         "Source Ticket": { url: zendesk_ticket_url }
       }
       children: [
         { heading_2: { rich_text: [{ text: { content: "Problem" } }] } },
         { paragraph: { rich_text: [{ text: { content: summary.problem } }] } },
         { heading_2: { rich_text: [{ text: { content: "Solution" } }] } },
         { numbered_list_item: { rich_text: [{ text: { content: step } }] } },
         // ... per solution step
       ]
  4. Slack alert to #docs: "Draft KB article ready: {notion_url}"
```

### 3. Notion-as-CRM — Stripe customer → database row

```
Stripe customer.created → Routine fires →
  1. POST /pages
       parent: { database_id: "<customers-db-id>" }
       properties: {
         "Name":         { title: [{ text: { content: customer.name } }] },
         "Email":        { email: customer.email },
         "Stripe ID":    { rich_text: [{ text: { content: customer.id } }] },
         "Created":      { date: { start: customer.created_at_iso } },
         "Status":       { select: { name: "Active" } },
         "Lifetime Value": { number: 0 }
       }
  2. Cache the returned page_id alongside the Stripe customer in
     AutoFlow's reverse-index store so future Stripe events can patch
     the right Notion row.
```

### 4. Weekly recap → append to running doc

```
Cron routine Friday 5pm →
  1. Collect the workspace's stats for the week (routines fired,
     tickets resolved, revenue, etc.) from the various source tools
  2. PATCH /blocks/{weekly-recap-page-id}/children to APPEND
       (not replace) a new section:
       [
         { heading_2: { rich_text: [{ text: { content: "Week of {date}" } }] } },
         { paragraph: { rich_text: [{ text: { content: summary } }] } },
         // ... table or list of stats
       ]
  3. The running doc accumulates history without losing previous weeks.
```

## Database query syntax

Notion's database queries are JSON DSL similar to MongoDB:

```
POST /databases/{db_id}/query
body:
  filter:
    and:
      - { property: "Status", select: { equals: "Active" } }
      - { property: "Date", date: { after: "2026-05-01" } }
  sorts:
    - { property: "Date", direction: "descending" }
  page_size: 100
```

Pagination is cursor-based (`start_cursor` + `has_more`). For exports of large databases, page through serially.

## Idempotency

Notion has no Idempotency-Key header. For inserts, dedupe by querying first with a unique property:

```
1. POST /databases/{customers-db}/query
   filter: { property: "Stripe ID", rich_text: { equals: customer.id } }
2. If results.length === 0, POST /pages to create
   Else, PATCH /pages/{existing.id} to update
```

This "query-then-write" pattern is the AutoFlow shape for Notion-as-CRM workflows.

## Webhooks

Notion's **webhook support is limited as of 2026** — only available via the public API for OAuth integrations, and only a subset of event types. For routines that need to react to Notion-side changes, the practical approach is **polling on a cron** (e.g. "every 5 min, query the database for rows updated since last_run_at").

## Rate limits

- **3 requests/sec average** (token bucket with burst allowance).
- 429 returns `Retry-After`.
- Heavy operations (full-database export, deep tree traversal) need throttling — don't iterate without delays.

## What this skill does NOT cover

- **Notion AI** (their in-product AI) — separate feature, not API-exposed in a useful way.
- **Notion Calendar** — Notion's calendar product is consumer-focused; AutoFlow customers use Calendly + Google Calendar.
- **Page version history** — readable in Notion's UI; the API doesn't expose it.
- **File uploads** — supported but awkward (must host the file externally and pass URL). Most agents skip this and link rather than embed.

## References

- API: https://developers.notion.com/reference/intro
- Block reference: https://developers.notion.com/reference/block
- Database query: https://developers.notion.com/reference/post-database-query
- Versioning: https://developers.notion.com/reference/versioning
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce; pages/databases must be explicitly shared with the integration via Notion UI)
