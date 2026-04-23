# DocuSign Connector

## Marketplace Listing Copy

Connect DocuSign in under 60 seconds to automate envelope creation, lifecycle tracking, and signed-document workflows.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback (access token + account context)
- Supported actions: validate connection, list envelopes, create envelopes, fetch envelope status
- Supported events: DocuSign Connect webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **DocuSign** under integrations.
2. Click **Connect with DocuSign** for OAuth (recommended), or use **Connect with Access Token** when a direct token-based flow is required.
3. For OAuth setup, configure these env vars in AutoFlow:
   - `DOCUSIGN_CLIENT_ID`
   - `DOCUSIGN_CLIENT_SECRET`
   - `DOCUSIGN_REDIRECT_URI`
   - `DOCUSIGN_SCOPES` (optional override, default `signature extended offline_access`)
   - `DOCUSIGN_OAUTH_BASE_URL` (optional override, default `https://account-d.docusign.com/oauth`)
4. For webhook intake, configure:
   - `DOCUSIGN_WEBHOOK_SECRET`
   - DocuSign Connect URL: `https://<your-domain>/api/webhooks/docusign/connect`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and envelope operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/docusign/health`

## Error Taxonomy

The DocuSign connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/docusign/connections/:id`.
- Webhooks validate HMAC signatures (`X-DocuSign-Signature-1`) and enforce replay protection using delivery IDs.
