# Apollo Connector

## Marketplace Listing Copy

Connect Apollo in under 60 seconds to authorize prospecting and enrichment workflows with secure OAuth or API-key fallback.

- Auth options: OAuth 2.0 authorization code flow or API-key fallback
- Supported actions: start OAuth, exchange tokens, validate connection, list active connections, revoke credentials
- Supported operations: token refresh, encrypted credential storage, connector health checks

## Setup Guide

1. Open AutoFlow dashboard and choose **Apollo** under integrations.
2. Click **Connect with Apollo** to use OAuth, or choose **Connect with API Key** when your workspace prefers direct token entry.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `APOLLO_CLIENT_ID`
   - `APOLLO_CLIENT_SECRET`
   - `APOLLO_REDIRECT_URI`
   - `APOLLO_SCOPES` (optional override, default `read_user_profile`)
   - `APOLLO_OAUTH_AUTHORIZE_URL` (optional override, default `https://app.apollo.io/#/oauth/authorize`)
   - `APOLLO_OAUTH_TOKEN_URL` (optional override, default `https://app.apollo.io/api/v1/oauth/token`)
4. Ensure the Apollo app redirect URL matches:
   - `https://<your-domain>/api/integrations/apollo/oauth/callback`
5. Click **Test Connection** to verify the credential before enabling any workflow that depends on Apollo.

## Auth Notes

- Apollo currently uses a standard OAuth 2.0 authorization code exchange in AutoFlow.
- PKCE is not documented in the current Apollo connector implementation; do not label this flow as PKCE in frontend copy or operator runbooks.
- API-key fallback should remain available for customers who cannot complete the OAuth app setup.

## Supported Routes

- `POST /api/integrations/apollo/oauth/start`
- `GET /api/integrations/apollo/oauth/callback`
- `POST /api/integrations/apollo/connect-api-key`
- `GET /api/integrations/apollo/connections`
- `POST /api/integrations/apollo/test-connection`
- `GET /api/integrations/apollo/health`
- `DELETE /api/integrations/apollo/connections/:id`

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test-connection checks)
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
- OAuth credentials support refresh-token rotation when Apollo returns refresh tokens.
