# PostHog Connector

## Marketplace Listing Copy

Connect PostHog in under 60 seconds to automate event ingestion, feature-flag sync, and webhook-driven workflows.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback
- Supported actions: validate connection, list projects, list feature flags, capture events
- Supported events: PostHog webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **PostHog** under integrations.
2. Click **Connect with PostHog** for OAuth (recommended), or use **Connect with API Key** if your workspace requires token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `POSTHOG_CLIENT_ID`
   - `POSTHOG_CLIENT_SECRET`
   - `POSTHOG_REDIRECT_URI`
   - `POSTHOG_SCOPES` (optional override)
   - `POSTHOG_OAUTH_BASE_URL` (optional override; defaults to `https://app.posthog.com/oauth`)
4. For API calls and ingest endpoint overrides (optional):
   - `POSTHOG_API_BASE_URL` (defaults to `https://app.posthog.com`)
   - `POSTHOG_CAPTURE_BASE_URL` (defaults to `https://us.i.posthog.com`)
5. For webhook intake, configure:
   - `POSTHOG_WEBHOOK_SECRET`
   - PostHog webhook URL: `https://<your-domain>/api/webhooks/posthog/events`
6. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test, project sync, feature-flag sync, event capture)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/posthog/health`

## Error Taxonomy

The PostHog connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/posthog/connections/:id`.
- Webhooks validate HMAC signatures and enforce replay protection.
