# HubSpot Connector

## Marketplace Listing Copy

Connect HubSpot in under 60 seconds to automate CRM sync, contact and deal workflows, and webhook-driven lead routing.

- Auth options: OAuth2 authorization code (recommended) or private-app token fallback
- Supported actions: validate connection, list/create/update contacts, companies, and deals
- Supported events: HubSpot webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **HubSpot** under integrations.
2. Click **Connect with HubSpot** for OAuth, or use **Connect with API Key** if your workspace requires private-app token fallback.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `HUBSPOT_CLIENT_ID`
   - `HUBSPOT_CLIENT_SECRET`
   - `HUBSPOT_REDIRECT_URI`
   - `HUBSPOT_SCOPES` (optional override)
   - `HUBSPOT_OAUTH_AUTHORIZE_URL` (optional override; defaults to `https://app.hubspot.com/oauth/authorize`)
   - `HUBSPOT_OAUTH_TOKEN_URL` (optional override; defaults to `https://api.hubapi.com/oauth/v1/token`)
   - `HUBSPOT_OAUTH_METADATA_URL` (optional override; defaults to `https://api.hubapi.com/oauth/v1/access-tokens`)
   - `HUBSPOT_API_BASE_URL` (optional override; defaults to `https://api.hubapi.com`)
4. For webhook intake, configure:
   - HubSpot webhook URL: `https://<your-domain>/api/webhooks/hubspot/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and private-app token flows)
- `sync` (manual test and CRM sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/hubspot/health`

## Error Taxonomy

The HubSpot connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/hubspot/connections/:id`.
- Webhooks validate the `x-hubspot-signature-v3` signature and enforce replay protection.
- OAuth access tokens refresh automatically when the stored token nears expiry.
