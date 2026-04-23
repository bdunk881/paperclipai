# Microsoft Teams Connector

## Marketplace Listing Copy

Connect Microsoft Teams in under 60 seconds to automate chat sync, team activity workflows, and webhook-driven collaboration triggers.

- Auth options: OAuth2 with PKCE (recommended) or access-token fallback
- Supported actions: validate connection, list teams, list chats, list channel messages
- Supported events: Teams webhook receiver with client-state validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Microsoft Teams** under integrations.
2. Click **Connect with Microsoft Teams** for OAuth (recommended), or use **Connect with API Key** if your workspace requires access-token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `TEAMS_CLIENT_ID`
   - `TEAMS_CLIENT_SECRET`
   - `TEAMS_REDIRECT_URI`
   - `TEAMS_SCOPES` (optional override)
   - `TEAMS_TENANT_ID` (optional override; defaults to `common`)
4. For webhook intake, configure:
   - `TEAMS_WEBHOOK_CLIENT_STATE`
   - Teams webhook URL: `https://<your-domain>/api/webhooks/teams/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and access-token flows)
- `sync` (manual test and message sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/teams/health`

## Error Taxonomy

The Microsoft Teams connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/teams/connections/:id`.
- Webhooks validate `clientState` and enforce replay protection before processing events.
- OAuth access tokens refresh automatically when the stored token nears expiry.
