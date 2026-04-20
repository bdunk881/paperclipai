# Slack Connector

## Marketplace Listing Copy

Connect Slack in under 60 seconds to automate channel monitoring, message sync, and workflow-triggered notifications.

- Auth options: OAuth2 with PKCE (recommended) or API-key fallback (bot token)
- Supported actions: validate connection, list channels, read channel history, send messages
- Supported events: Slack Events API webhook receiver with signature validation and replay protection

## Setup Guide

1. Open AutoFlow dashboard and choose **Slack** under integrations.
2. Click **Connect with Slack** for OAuth (recommended), or use **Connect with Bot Token** if your workspace requires API-key fallback.
3. For OAuth setup, make sure these env vars are configured in AutoFlow:
   - `SLACK_CLIENT_ID`
   - `SLACK_CLIENT_SECRET`
   - `SLACK_REDIRECT_URI`
   - `SLACK_SCOPES` (optional override)
4. For webhook events, configure:
   - `SLACK_SIGNING_SECRET`
   - Slack Events Request URL: `https://<your-domain>/api/webhooks/slack/events`
5. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and data fetch operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (event delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/slack/health`

## Error Taxonomy

The Slack connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted at rest before storage.
- Credentials are revocable via `DELETE /api/integrations/slack/connections/:id`.
- Webhooks validate Slack signatures (`X-Slack-Signature`) and enforce timestamp replay windows.
