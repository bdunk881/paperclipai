# Intercom Connector

## Marketplace Listing Copy

Connect Intercom in under 60 seconds to automate customer conversation workflows, contact sync, and ticket response operations.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback (Intercom access token)
- Supported actions: validate connection, list/create/update contacts, list/create/reply conversations
- Supported events: Intercom webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Intercom** under integrations.
2. Click **Connect with Intercom** for OAuth (recommended), or use **Connect with API Key** if your workspace requires token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `INTERCOM_CLIENT_ID`
   - `INTERCOM_CLIENT_SECRET`
   - `INTERCOM_REDIRECT_URI`
   - `INTERCOM_SCOPES` (optional override)
   - `INTERCOM_OAUTH_AUTHORIZE_URL` (optional override)
   - `INTERCOM_OAUTH_TOKEN_BASE_URL` (optional override)
4. For API behavior and webhook intake, configure:
   - `INTERCOM_API_BASE_URL` (optional override)
   - `INTERCOM_API_VERSION` (optional override)
   - `INTERCOM_WEBHOOK_SECRET`
   - Intercom webhook URL: `https://<your-domain>/api/webhooks/intercom/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (contact/conversation operations and manual test)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/intercom/health`

## Error Taxonomy

The Intercom connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/intercom/connections/:id`.
- Webhooks validate HMAC signatures (`x-hub-signature-256`/`x-hub-signature`) and enforce replay protection.
