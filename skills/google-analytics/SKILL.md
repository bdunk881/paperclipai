---
name: google-analytics
description: Use this skill when an AutoFlow agent needs to read GA4 web/app analytics or push server-side events to GA4 — pull traffic, conversion, or attribution reports into a routine, send Measurement Protocol events for server-side conversions (Stripe purchase, lead form submission, login), feed analytics into HubSpot lead scoring, or wire scheduled reporting to Slack. Covers GA4's Data API (read) and Measurement Protocol (write), the OAuth + service-account auth model, the Property / Dimension / Metric / DateRange model, and the workflow shape AutoFlow customers reach for (daily KPI report, server-side conversion event, attribution-driven lead enrichment).
---

# Google Analytics 4 — web + app analytics

GA4 is the de-facto web analytics platform for AutoFlow's SMB segment. It replaced Universal Analytics in 2023; any customer integration AutoFlow ships in 2026 talks to GA4 only. Two API surfaces matter: **Data API** (read aggregated reports) and **Measurement Protocol** (push server-side events).

## When to reach for this skill

- **Daily KPI report** — sessions, conversions, top channels → Slack summary or reporting dashboard.
- **Server-side conversion event** — Stripe purchase, lead form submission, sign-up — fire to GA4 from the AutoFlow backend (more reliable than client-side gtag because ad-blockers don't see it).
- **Attribution lookup** — when a lead converts, pull their first-touch channel + utm_source for CRM enrichment.
- **A/B test outcome** — pull conversion rates by experiment variant for routine-driven decisions.
- **Anomaly detection** — daily check for "traffic dropped >30% vs 7-day baseline" → alert routine.
- **Marketing automation feed** — high-intent visitor signals (multiple visits + product page views) → enrich HubSpot contact + tag for sales follow-up.

## Authentication

Two API surfaces, two auth models:

### Data API (read)

Three flavors, in order of preference for AutoFlow's pattern:

- **Service Account** — server-to-server, no user interaction. Create a service account in Google Cloud, share the GA4 property with its email, give it Viewer role. AutoFlow signs JWTs and exchanges for access tokens. This is the AutoFlow pattern.
- **OAuth 2** — multi-tenant SaaS where each customer authorizes their own GA4. Standard authorization-code flow.
- **API Key** — works for some public reports but not for property-scoped queries. Rarely useful.

```
Authorization: Bearer <google-access-token>
```

Base URL: `https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport`

The **property ID** is a numeric ID (e.g. `123456789`), NOT the measurement ID (the `G-XXXXXXXXXX` thing). Capture both at install time — they're used by different APIs.

### Measurement Protocol (write)

Uses an **API secret** generated in GA4's UI per data stream:

```
POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXXXXXXX&api_secret=<secret>
Body: { "client_id": "...", "events": [{ "name": "...", "params": {...} }] }
```

`client_id` is GA4's unique-user identifier. For server-side events, use the client-id cookie value if available (read from the request that triggered the conversion); otherwise generate a stable UUID per user and store it on their CRM record.

## Core read API — `runReport`

The Data API's main endpoint is a single shape:

```
POST /properties/{property_id}:runReport
body:
  dateRanges: [{ startDate: "7daysAgo", endDate: "today" }]
  dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }]
  metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }]
  dimensionFilter:
    filter:
      fieldName: "sessionSource"
      stringFilter: { matchType: "EXACT", value: "google" }
  limit: 100
```

### Dimensions agents reach for most

| Dimension | What it gives you |
|---|---|
| `date` | YYYYMMDD bucket |
| `sessionSource`, `sessionMedium`, `sessionCampaignName` | First-touch attribution |
| `firstUserSource`, `firstUserMedium` | First-visit attribution (lifetime) |
| `country`, `region`, `city` | Geo |
| `deviceCategory`, `browser` | Tech fingerprint |
| `pagePath` | Most-visited pages |
| `eventName` | Custom event reporting |

### Metrics agents reach for most

| Metric | What it gives you |
|---|---|
| `sessions` | Engaged + non-engaged session count |
| `engagedSessions` | Sessions with >10s engagement |
| `activeUsers` | Distinct user count in the range |
| `conversions` | Goal completions |
| `totalRevenue` | Sum of `purchase` event values |
| `eventCount` | Count of any event by name |

## Common AutoFlow workflows

### 1. Daily KPI report → Slack

```
Cron routine at 9am →
  1. runReport: { yesterday, last_7d } for sessions + conversions + revenue
     by source + medium
  2. Format a Slack message:
       "📊 Yesterday: 4,300 sessions (+12% vs avg), 47 conversions, $8,200 revenue
        Top sources: google/organic (1,800), direct/(none) (900), email (600)"
  3. POST to the workspace's #marketing channel.
```

### 2. Stripe purchase → server-side purchase event

```
Stripe webhook checkout.session.completed → Routine fires →
  1. Read client_id from session.metadata (was set when AutoFlow generated
     the Stripe Checkout URL; backend captured it from the GA4 _ga cookie)
  2. POST Measurement Protocol:
       events: [{
         name: "purchase",
         params: {
           transaction_id: session.id,
           value: session.amount_total / 100,
           currency: session.currency.toUpperCase(),
           items: [...]  // mapped from session.line_items
         }
       }]
  3. GA4's "Monetization" reports now show the conversion + revenue, even
     for users who blocked the client-side gtag.
```

### 3. Lead converts → attribution enrichment

```
HubSpot form submission (or Calendly booking) → Routine fires →
  1. Read the GA4 _ga cookie from the conversion request → client_id
  2. runReport on user_pseudo_id = client_id for last 30 days:
       dimensions: firstUserSource, firstUserMedium, sessionCampaignName
       metrics: sessions
  3. Take the result row with most sessions → use as the lead's attributed source
  4. PATCH HubSpot contact:
       firstattribution_source = "google"
       firstattribution_medium = "organic"
       firstattribution_campaign = "summer-promo"
```

### 4. Traffic anomaly detection

```
Cron routine hourly during business hours →
  1. runReport: sessions today (current hour) + same hour last 7 days
  2. If today_value < 0.7 * 7d_avg AND 7d_avg > 100:
       Slack alert to #marketing: "Traffic anomaly: -35% vs avg this hour"
       Page on-call if drop is severe + persistent
  3. (Tunable thresholds per workspace setting)
```

## Idempotency

**Measurement Protocol is fire-and-forget; there's no idempotency key.** Sending the same `purchase` event twice creates two transactions in GA4. AutoFlow routines must dedupe upstream — only fire from a single source-of-truth webhook handler (Stripe, not Stripe+Shopify simultaneously for the same order).

For the Data API, every call is idempotent by definition (read-only).

## Rate limits

### Data API

- **40,000 requests/day** per project per property (default; can be raised on request).
- **10 requests/second** burst per project.
- **Concurrent quota** — only N reports in-flight at once per property.
- 429 returns standard backoff hints. The official Google Auth library handles retry.

### Measurement Protocol

- No published rate limit — GA4 ingests at very high throughput.
- Validate test events against `/debug/mp/collect` (sandbox-mode) before going to prod; production payloads silently drop if malformed.

## What this skill does NOT cover

- **Universal Analytics** (UA, pre-2023) — sunset July 2023; not on AutoFlow's path. If a customer asks for UA, point them at GA4 migration.
- **Google Tag Manager** — adjacent product; managed in customer's GTM UI, not via AutoFlow.
- **Looker Studio / Data Studio** — visualization layer on top of GA4; build dashboards there, not in AutoFlow.
- **BigQuery export** — GA4 streams to BigQuery for advanced analysis. If a customer needs that, author a `bigquery` skill for the warehouse layer.
- **Ads conversion-import** — for Google Ads conversion tracking, use the Google Ads API directly, not the GA4 Measurement Protocol (results differ).

## References

- Data API: https://developers.google.com/analytics/devguides/reporting/data/v1
- Measurement Protocol: https://developers.google.com/analytics/devguides/collection/protocol/ga4
- Service account setup: https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries
- Dimensions + metrics catalog: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- AutoFlow integration shape: `src/ticketSync/` (service-account JSON stored in secrets store; OAuth refresh tokens for multi-tenant alt path)
