# Shopify Connector

## Marketplace Listing Copy

Connect Shopify in under 60 seconds to automate product, order, and customer workflows with secure OAuth or Admin API token fallback.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback (Admin API token)
- Supported actions: validate connection, list/create/update products, list orders, list customers, subscribe webhooks
- Supported events: Shopify webhooks with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Shopify** under integrations.
2. Click **Connect with Shopify** for OAuth (recommended), or use **Connect with Admin API Token** if OAuth is not available for your store.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `SHOPIFY_CLIENT_ID`
   - `SHOPIFY_CLIENT_SECRET`
   - `SHOPIFY_REDIRECT_URI`
   - `SHOPIFY_SCOPES` (optional override)
   - `SHOPIFY_API_VERSION` (optional, defaults to `2024-10`)
4. For webhook intake, configure:
   - `SHOPIFY_WEBHOOK_SECRET`
   - Shopify webhook URL: `https://<your-domain>/api/webhooks/shopify/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and data sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/shopify/health`

## Error Taxonomy

The Shopify connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/shopify/connections/:id`.
- Webhooks validate Shopify HMAC signatures (`X-Shopify-Hmac-Sha256`) and enforce replay protection using event IDs.
