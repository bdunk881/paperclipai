---
name: mindbody
description: Use this skill when an AutoFlow agent needs to read or write data in Mindbody — the practice-management platform for fitness, wellness, yoga, salon, spa, and personal-training SMBs. Pull clients / classes / appointments / sales, react to booking events, sync purchases to QuickBooks, push membership and class data into marketing tools, manage waitlists. Covers Mindbody's Public API v6 + OAuth-style site activation, the Site / Client / Class / Service / Sale / Appointment model, and the workflow shape AutoFlow customers reach for (class booked → CRM upsert + reminder, late cancellation → fee charge, membership purchased → onboarding routine, wait-list auto-promote).
---

# Mindbody — fitness, wellness, salon, spa management

Mindbody is the dominant practice-management platform for AutoFlow's wellness-vertical SMBs — yoga studios, gyms, pilates, barre, personal training, hair salons, day spas, nail studios, massage practices, dance studios. It owns the scheduling + client + membership + retail + marketing surface that small wellness businesses need to operate end-to-end.

Use Mindbody for the "people book classes / appointments and you bill them for memberships, packages, or sessions" shape. For pure restaurants → Toast. For mobile services (lawn care, plumbing) → Jobber. For office services (law, accounting) → HubSpot + Calendly.

## When to reach for this skill

- **Class booked / canceled** → CRM upsert, send reminder SMS via Twilio, charge late-cancel fee if applicable.
- **Appointment scheduled** → confirm + 24h-before reminder (matches Calendly skill's pattern but Mindbody-native).
- **Membership purchased** → onboarding routine (welcome SMS + email, calendar of first 4 classes, intro discount).
- **Membership renewed / expired** → re-engagement sequence on expiry; thank-you on renewal.
- **Class waitlist** → auto-promote from waitlist on cancellation, notify promoted client.
- **Daily reconciliation** → roll the day's sales (classes, retail, memberships) into QBO journal entries.
- **No-show pattern** → flag clients with chronic no-shows for staff review.

## Authentication

Mindbody's auth model is **specific to the platform** and trips first-timers:

1. AutoFlow registers a Source name + Source password with Mindbody (one-time, in the partner portal).
2. Each customer's Mindbody site must be **activated** for the source — the customer toggles permission in their Mindbody admin UI per integration.
3. After activation, AutoFlow exchanges Source+SiteID for a session token via `/public/v6/usertoken/issue`:

   ```
   POST /public/v6/usertoken/issue
   Headers:
     SiteId: <site-id>
     Api-Key: <source-api-key>
   Body:
     Username: "Siteowner"
     Password: "apidemoCA"   (or per-site values for non-Public API)
   ```

4. Subsequent calls use the returned token:

   ```
   Authorization: Bearer <mindbody-session-token>
   Api-Key: <source-api-key>
   SiteId: <site-id>
   ```

Tokens are scoped per site. A customer with multiple studios (e.g. yoga chain) has multiple SiteIds, each requiring its own activation + token. AutoFlow's connection record enumerates them at install.

Base URL: `https://api.mindbodyonline.com/public/v6/`

## Core API surface

Mindbody's API is REST + organized by feature area:

| Area | Endpoint prefix | What it's for |
|---|---|---|
| Site | `/site/sites`, `/site/locations` | The studio's own metadata + locations |
| Client | `/client/clients` | Customer records |
| Class | `/class/classes` | Group fitness classes (yoga, spin, etc.) |
| Class Schedules | `/class/classschedules` | When + where classes recur |
| Class Sign-up | `/class/addclienttoclass` | Book a client into a class |
| Class Waitlist | `/class/waitlistentries` | Waitlist management |
| Appointments | `/appointment/appointments` | 1-on-1 sessions (massage, personal training) |
| Sales | `/sale/sales` | Retail + service purchases |
| Contracts | `/sale/contracts` | Membership / package contracts |
| Staff | `/staff/staff` | Instructors, therapists, stylists |
| Enrollments | `/enrollment/enrollments` | Multi-class series (workshops, programs) |
| Webhooks | `/webhook/...` (partner program) | Push events |

## Common AutoFlow workflows

### 1. Class booked → CRM upsert + reminder

```
Mindbody webhook classClientAdded → Routine fires →
  1. GET /client/clients/{clientId} for email + phone
  2. HubSpot PUT /crm/v3/objects/contacts/{email}?idProperty=email
       update lifecycle stage, last_class_booked timestamp
  3. Schedule cron 24h before class.startDateTime:
       POST Twilio /Messages "Reminder: {class.name} tomorrow at {time}"
  4. Optional: Mailchimp/Klaviyo event "Class Booked" for segmentation.
```

### 2. Late cancellation → fee charge

```
Mindbody webhook classClientRemoved (where cancellation_time < class_start + late_window) →
Routine fires →
  1. Look up the site's late-cancel policy (configured in workspace settings):
       e.g. "$15 late-cancel fee for cancellations within 2h of class"
  2. POST /sale/checkoutshoppingcart with the late-fee SKU + client_id
       Pay via card-on-file (clients usually have one stored for class booking)
  3. SMS client: "We charged a $15 late-cancel fee per studio policy.
                  Reply HELP for questions."
  4. Log to the workspace's policy-enforcement audit table.
```

### 3. Membership purchased → onboarding routine

```
Mindbody webhook clientSaleCreated (where line items include a contract) →
Routine fires →
  1. GET /sale/sales/{sale_id} for contract details
  2. POST QBO /invoice + /payment to record the membership revenue
     (see quickbooks-online skill)
  3. Mailchimp/Klaviyo: enroll in the "New Member Welcome" series
     - Day 0: welcome email + class recommendations
     - Day 3: "How to book classes" tutorial
     - Day 7: "Try a different format" cross-sell
     - Day 14: first-month check-in
  4. SMS welcome: "🧘 Welcome to {studio}! Your first class is on us."
  5. Auto-book the client into 3-4 recommended starter classes (with
     human confirmation step in the routine).
```

### 4. Waitlist auto-promote

```
Mindbody webhook classWaitlistEntryAdded OR classClientRemoved →
Routine fires →
  1. GET /class/classes/{class_id} → spotsRemaining + currentBookings
  2. If spotsRemaining > 0 AND there's a waitlist:
       GET /class/waitlistentries?classId={...}
       Take the entry with lowest priority number (first in line)
       POST /class/addclienttoclass to promote
       POST /class/removewaitlistentry
       SMS them: "🎉 A spot opened in {class.name} at {time}. You're in!"
  3. Update HubSpot timeline event for visibility.
```

### 5. Daily reconciliation → QBO

```
Cron routine at 11pm site-local time →
  1. GET /sale/sales?StartSaleDate={today_00:00}&EndSaleDate={today_23:59}
     (paginate)
  2. Aggregate:
       class_revenue (sale_items where item.type = class)
       retail_revenue (items where category = retail)
       membership_revenue (items where item.type = contract)
       refunds (sales where total < 0)
       tips (sale_items where item.type = tip)
  3. POST QBO /journalentry:
       Debit Bank "Mindbody Clearing" (net)
       Credit Class Revenue (class)
       Credit Retail Revenue (retail)
       Credit Membership Revenue (membership)
       Credit Tips Payable (tips)
       PrivateNote: "Mindbody daily reconciliation for {date}"
```

## Idempotency

Mindbody does NOT expose idempotency-key headers. For routine-driven writes, dedupe by:
- For client upserts: `Email` is unique within a site → `GET /client/clients?SearchText={email}` first
- For class bookings: `clientId + classId` is the natural unique key
- For sales: the routine-side correlation ID stored in the sale's external reference field

## Webhooks

Mindbody's webhook system requires enrollment in their Partner Program for production use. Subscribe via the partner portal or the `/webhook/...` API once enrolled.

Common topics:
- `client.created`, `client.updated`
- `client.classAdded`, `client.classRemoved`
- `client.appointmentBooked`, `client.appointmentCanceled`
- `class.waitlistEntryAdded`
- `client.contractCreated` (membership purchase)
- `sale.checkoutCompleted`

Signature verification: webhooks include `X-MindbodyMessageSignature` (HMAC-SHA256). Verify before processing.

For SMBs not yet on the Partner Program, AutoFlow falls back to **polling** — cron every 5-15 min over the relevant endpoints with `?LastModifiedDate>=...`.

## Rate limits

- **1,000 requests/hour** per API key for Public API.
- **2,000/hour** on premium tiers.
- 429 returns standard `Retry-After`.
- Bulk operations are limited; for large data exports use the `LastModifiedDate` filter for incremental sync rather than full re-pulls.

## Multi-site customer pattern

Larger Mindbody customers (yoga studio chains, salon franchises) operate **many sites under one parent organization**. Each site has its own SiteId + activation + client list. AutoFlow's pattern:
- Treat each SiteId as a separate AutoFlow connection
- Optionally group connections under a workspace "brand" for cross-site reporting

This keeps booking + member data appropriately siloed per location.

## What this skill does NOT cover

- **Mindbody Business app** (their mobile staff app) — UI layer only, not API.
- **Mindbody Marketing Suite** — overlaps with Mailchimp/Klaviyo. Customers usually pick one; this skill's worked workflows route through Mailchimp/Klaviyo.
- **Mindbody Capital** (lending product) — financial service, not on AutoFlow's path.
- **ClassPass integration** — separate aggregator partnership; bookings come in as standard class bookings via the Mindbody API.

## References

- API: https://developers.mindbodyonline.com/PublicDocumentation/V6
- Auth: https://developers.mindbodyonline.com/PublicDocumentation/V6#authentication
- Webhooks (partner-only): https://developers.mindbodyonline.com/PartnerDocumentation/Webhooks
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; per-site activation; SiteId on every call)
