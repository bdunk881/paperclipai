# Datadog + Azure Monitor Connector

## Marketplace Listing Copy

Connect Datadog and Azure Monitor in under 60 seconds to unify metrics and alert ingestion into AutoFlow workflows.

- Auth options: OAuth2 with PKCE for Azure Monitor (recommended) and API-key fallback for Datadog
- Supported actions: validate connection, query Datadog metrics, list Azure subscriptions, query Azure metrics
- Supported events: signed alert webhook receiver with replay protection for Datadog and Azure Monitor

## Setup Guide

1. Open AutoFlow dashboard and choose **Datadog + Azure Monitor** under integrations.
2. Connect Datadog using API key (and optional app key for extended scopes).
3. Connect Azure Monitor using OAuth.
4. Configure Azure OAuth env vars:
   - `AZURE_MONITOR_CLIENT_ID`
   - `AZURE_MONITOR_CLIENT_SECRET`
   - `AZURE_MONITOR_REDIRECT_URI`
   - `AZURE_MONITOR_TENANT_ID` (optional; defaults to `common`)
   - `AZURE_MONITOR_SCOPES` (optional override)
5. Configure webhook secrets:
   - `DATADOG_WEBHOOK_SIGNING_KEY`
   - `AZURE_MONITOR_WEBHOOK_SIGNING_KEY`
6. Use webhook URL: `https://<your-domain>/api/webhooks/datadog-azure-monitor/alerts`
7. Click **Test Connection**.

## Observability

Structured log events emitted by this connector:

- `connect` (OAuth and API-key flows)
- `sync` (manual test and metric sync operations)
- `error` (auth, rate-limit, schema, network, upstream)
- `disconnect` (credential revoke)
- `webhook` (alert delivery)
- `health` (health-check polling)

Health-check endpoint:

- `GET /api/integrations/datadog-azure-monitor/health`

## Error Taxonomy

The connector classifies errors as:

- `auth`
- `rate-limit`
- `schema`
- `network`
- `upstream`

## Security Notes

- Connector credentials are encrypted before storage.
- Credentials are revocable via `DELETE /api/integrations/datadog-azure-monitor/connections/:id`.
- Webhooks require HMAC SHA-256 signatures and enforce replay protection.
