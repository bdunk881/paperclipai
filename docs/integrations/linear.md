# Linear Connector

## Marketplace Listing Copy

Connect Linear in under 60 seconds to automate issue triage, project sync, and workflow-triggered ticket operations.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback (Linear personal API key)
- Supported actions: validate connection, list projects, list issues, create issues, update issues
- Supported events: Linear webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Linear** under integrations.
2. Click **Connect with Linear** for OAuth (recommended), or use **Connect with API Key** if your workspace requires token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `LINEAR_CLIENT_ID`
   - `LINEAR_CLIENT_SECRET`
   - `LINEAR_REDIRECT_URI`
   - `LINEAR_SCOPES` (optional override)
4. For webhook intake, configure:
   - `LINEAR_WEBHOOK_SECRET`
   - Linear webhook URL: `https://<your-domain>/api/webhooks/linear/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and issue/project sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/linear/health`

## Error Taxonomy

The Linear connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/linear/connections/:id`.
- Webhooks validate HMAC signatures (`Linear-Signature` / `X-Linear-Signature`) and enforce replay protection.
