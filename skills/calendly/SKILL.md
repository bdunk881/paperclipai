---
name: calendly
description: Use this skill when an AutoFlow agent needs to read or react to scheduled meetings in Calendly — list a user's upcoming events, react to booking webhooks (create CRM contact, send a prep email, log to QuickBooks for billable time), or surface meeting metadata into a routine. Covers Calendly v2 OAuth + PAT auth, the resource shape (User / Event Type / Scheduled Event / Invitee), and the workflow shape AutoFlow customers reach for (booking → CRM contact + sequence, no-show → follow-up, post-meeting → billable line item).
---

# Calendly — appointment scheduling

Calendly is the dominant booking tool for SMB sales, support, and services. AutoFlow customers reach for it whenever an external person needs to pick a time on someone's calendar — discovery calls, demos, onboarding sessions, support escalations, billable consultations.

## When to reach for this skill

- **New booking** webhook → create a HubSpot contact + enroll in sequence, log a Slack alert to the assigned rep.
- **Booking cancellation** → trigger reschedule outreach or update CRM stage.
- **No-show** → fire a follow-up routine.
- **Post-meeting** → for billable customers (lawyers, consultants), turn the scheduled event into a QuickBooks line item / invoice draft.
- **Round-robin or team links** → look up which user got the booking.

## Authentication

Two paths:

- **Personal Access Token (PAT)** — single-user, simplest. Issued from the user's Calendly settings. Use this for AutoFlow's per-user integrations where the customer connects their own Calendly account.
- **OAuth 2.0** — multi-org. Required if AutoFlow ever ships a Calendly *app* installed by an entire workspace. Standard authorization-code flow with refresh tokens that **do not expire** (different from QuickBooks!).

```
Authorization: Bearer <pat-or-oauth-access-token>
Content-Type: application/json
```

Base URL: `https://api.calendly.com/`

The first call any integration must make is `GET /users/me` — Calendly's API is keyed off the **user URI** (a full URL like `https://api.calendly.com/users/ABC123`), and every subsequent query needs that URI as a filter. Cache the user/org URI at connection time.

## Core API surface

Calendly's API resources are **URIs, not IDs**. A scheduled event isn't `12345` — it's `https://api.calendly.com/scheduled_events/AAAAAAAAAAAAAAAA`. Always pass these as full URLs in query params and bodies.

| Resource | Endpoint | What it's for |
|---|---|---|
| Current User | `/users/me` | Bootstrap — get URI + organization URI |
| Event Types | `/event_types?user={user_uri}` | List the calendar links this user owns |
| Scheduled Events | `/scheduled_events?user={user_uri}` | List bookings (filter by status, time range) |
| Single Event | `/scheduled_events/{uuid}` | Full detail including meeting URL, location |
| Event Invitees | `/scheduled_events/{uuid}/invitees` | Who booked + their answers to intake questions |
| No Show | `/invitees/{uuid}/no_show` (POST/DELETE) | Mark/unmark a no-show |
| Webhooks | `/webhook_subscriptions` | Manage subscriptions |
| Routing Forms | `/routing_forms` | Pre-meeting intake form responses (if used) |

### Pagination

Calendly uses **cursor pagination**. Responses include `pagination.next_page` as a full URL — follow it until null. Don't try to construct page tokens manually.

## Common AutoFlow workflows

### 1. New booking → CRM contact + sequence

```
Calendly invitee.created webhook → Routine fires →
  1. Webhook payload has invitee.email + scheduled_event URI + questions_and_answers
  2. HubSpot PUT /crm/v3/objects/contacts/{email}?idProperty=email
     - populate firstname/lastname, set lifecyclestage=lead
     - tag with `source_calendly=true`
  3. Look up the relevant onboarding/sales sequence by event_type name
     (e.g. "30-min demo" → "demo follow-up sequence")
  4. Enroll the contact via HubSpot Workflows API
  5. (Optional) post a Slack alert to the booked rep
```

### 2. Cancellation → reschedule outreach

```
Calendly invitee.canceled webhook → Routine fires →
  1. Read the cancellation reason from the payload
  2. If reason is a no-show pattern, fire the no-show routine
  3. Otherwise, send a "sorry we missed you, here's another link" email
     with a Calendly booking link
  4. Update HubSpot lifecycle stage if the customer pattern matches
     ("never showed for demo" → cooler stage)
```

### 3. Post-meeting billable line item (services SMBs)

```
For a billable consultancy: meeting ends → routine fires →
  1. GET /scheduled_events/{uuid} for duration
  2. Look up the customer's hourly rate (from a workspace setting or
     the QuickBooks Customer's hourly billing field)
  3. POST QBO /invoice or append a line to a draft invoice for the customer
     (Item.Ref = "Consulting", quantity = duration_hours, rate = hourly_rate)
  4. PATCH the Calendly event to add a `quickbooks_invoice_id` annotation
     (via a custom-property store on AutoFlow's side, not Calendly's API)
```

## Webhooks

Calendly's webhook system is **subscription-based** — you create a subscription via API specifying which events you want and the destination URL.

```
POST /webhook_subscriptions
Body:
  url: "https://autoflow.example/webhooks/calendly/{workspace_id}"
  events: ["invitee.created", "invitee.canceled", "routing_form_submission.created"]
  organization: "https://api.calendly.com/organizations/XYZ"
  scope: "organization"   # or "user" for per-user subs
  signing_key: "...random..."
```

Signature verification: Calendly signs the payload with the `signing_key` you provided at subscription time, sent in `Calendly-Webhook-Signature`. Validate before trusting. Ingest pattern: `src/integrations/` follows the standard verification shape.

## Rate limits

Calendly's docs are vague — observed limit is roughly **1000 requests/minute** per token. Honor `Retry-After` on 429. The API surface is small enough that AutoFlow routines rarely hit it.

## Resource identity gotchas

- **The user URI is not the same as the user UUID.** The URI is the full `https://api.calendly.com/users/UUID` URL. Some endpoints want one form, some the other — always check.
- **Organization vs user scope.** Calendly Teams have an organization URI on top of each user URI. Webhook subscriptions can be `user` scope (one user's events) or `organization` scope (everyone's). Pick deliberately.
- **Event Type URI ≠ Booking URL.** The Event Type URI is the API resource; the customer-facing booking page URL is in the `scheduling_url` field of the EventType payload.

## What this skill does NOT cover

- **Calendly's analytics endpoints** (in beta) — useful for retros but not needed for routine-firing.
- **Workflows** (Calendly's internal automation product) — overlaps with AutoFlow's job, so customers don't usually configure both.
- **Meeting room integration** (Zoom/Meet URL generation) — Calendly handles this internally; AutoFlow just reads the resulting `location.join_url` from the scheduled event.

## References

- API: https://developer.calendly.com/api-docs
- Webhooks: https://developer.calendly.com/api-docs/d7755e2f9e5fb-webhook-subscription
- OAuth: https://developer.calendly.com/api-docs/14d3a7a7e220e-getting-started-with-the-api
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key, both supported)
