# Sentry Connector

## Marketplace Listing Copy

Connect Sentry in under 60 seconds to automate issue triage, project health sync, and webhook-driven incident workflows.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback
- Supported actions: validate connection, list projects, list issues
- Supported events: Sentry webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Sentry** under integrations.
2. Click **Connect with Sentry** for OAuth (recommended), or use **Connect with API Key** if your workspace requires token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `SENTRY_CLIENT_ID`
   - `SENTRY_CLIENT_SECRET`
   - `SENTRY_REDIRECT_URI`
   - `SENTRY_SCOPES` (optional override)
   - `SENTRY_OAUTH_BASE_URL` (optional override; defaults to `https://sentry.io`)
   - `SENTRY_API_BASE_URL` (optional override; defaults to `https://sentry.io`)
4. For webhook intake, configure:
   - Sentry webhook URL: `https://<your-domain>/api/webhooks/sentry/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test, project sync, and issue sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/sentry/health`

## Error Taxonomy

The Sentry connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/sentry/connections/:id`.
- Webhooks validate the `sentry-hook-signature` digest and enforce replay protection.
- OAuth access tokens refresh automatically when the stored token nears expiry.
