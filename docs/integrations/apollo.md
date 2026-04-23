# Apollo Connector

## Marketplace Listing Copy

Connect Apollo in under 60 seconds to automate prospect enrichment, account sync, and outbound workflow triggers.

- Auth options: OAuth2 authorization code (recommended where available) or API-key fallback
- Supported actions: validate connection, view account context, list saved connections
- Supported events: health-check and shared bridge connection status

## Setup Guide

1. Open AutoFlow dashboard and choose **Apollo** under integrations.
2. Click **Connect with Apollo** for OAuth, or use **Connect with API Key** if your workspace requires token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `APOLLO_CLIENT_ID`
   - `APOLLO_CLIENT_SECRET`
   - `APOLLO_REDIRECT_URI`
   - `APOLLO_SCOPES` (optional override)
   - `APOLLO_OAUTH_AUTHORIZE_URL` (optional override; defaults to `https://app.apollo.io/#/oauth/authorize`)
   - `APOLLO_OAUTH_TOKEN_URL` (optional override; defaults to `https://app.apollo.io/api/v1/oauth/token`)
4. OAuth callback URL:
   - `https://<your-domain>/api/integrations/apollo/oauth/callback`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and account sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/apollo/health`

## Error Taxonomy

The Apollo connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/apollo/connections/:id`.
- OAuth access tokens refresh automatically when the stored token nears expiry.
- The shared bridge route can initiate and monitor Apollo through `POST /api/integrations/apollo/connect` and `GET /api/integrations/status`.
