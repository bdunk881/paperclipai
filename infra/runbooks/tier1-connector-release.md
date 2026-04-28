# Tier 1 Connector Release Runbook

This runbook defines the staging-to-production release path for the Tier 1 connector set tracked by [ALT-1942](/ALT/issues/ALT-1942):

- Slack
- HubSpot
- Stripe
- Gmail
- Sentry
- Linear
- Microsoft Teams
- Jira

## 1) Release topology

Tier 1 connectors ship as part of the backend API release. There is no connector-specific code editing during rollout.

- `staging` branch deploys the backend to the staging Azure target via `.github/workflows/deploy-azure.yml`
- `master` deploys the backend to production after the `Staging-First Promotion Gate` allows the `staging -> master` promotion PR
- Connector verification runs after each deploy and blocks the workflow if routes or manifests regress
- Rollback uses the same workflow in `workflow_dispatch` mode with `operation=rollback` and a prior backend image tag

## 2) Approved promotion path

1. Merge the connector change into `staging`
2. Wait for `Deploy Backend to Azure` to finish successfully against the `staging` environment
3. Review the connector smoke evidence artifact from that run
4. Open a PR from `staging` into `master`
5. Merge only after the `Staging-First Promotion Gate` and required approvals pass
6. Allow the `master` push to trigger the production backend deployment
7. Review the production connector smoke evidence artifact

## 3) Rollback path

Rollback never requires code edits.

1. Identify the last known-good backend image tag in GHCR, for example `sha-<commit>`
2. Open `Deploy Backend to Azure` from the GitHub Actions UI
3. Choose the target environment
4. Set `operation` to `rollback`
5. Set `rollback_image_tag` to the prior image tag
6. Run the workflow and confirm the post-rollback connector smoke artifact is green

## 4) Connector configuration contract

These values must be present in the target environment before rollout.

| Connector | Auth mode | Required app/env config | Callback / webhook settings |
|---|---|---|---|
| Slack | OAuth2 PKCE or API key | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_SIGNING_SECRET`, `SLACK_SCOPES` | Redirect URI: `https://<api-host>/api/integrations/slack/oauth/callback`; webhook: `https://<api-host>/api/webhooks/slack/events` |
| HubSpot | OAuth2 PKCE or private app token | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI`, `HUBSPOT_SCOPES` | Redirect URI: `https://<api-host>/api/integrations/hubspot/oauth/callback`; webhook: `https://<api-host>/api/webhooks/hubspot/events` |
| Stripe | OAuth or API key | `STRIPE_CLIENT_ID`, `STRIPE_CLIENT_SECRET`, `STRIPE_REDIRECT_URI`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_OAUTH_SCOPE` | Redirect URI: `https://<api-host>/api/integrations/stripe/oauth/callback`; webhook: `https://<api-host>/api/webhooks/stripe` |
| Gmail | OAuth2 PKCE | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_SCOPES`, optional Pub/Sub envs | Redirect URI: `https://<api-host>/api/integrations/gmail/oauth/callback`; webhook: `https://<api-host>/api/webhooks/gmail/notifications` |
| Sentry | OAuth2 PKCE or API key | `SENTRY_CLIENT_ID`, `SENTRY_CLIENT_SECRET`, `SENTRY_REDIRECT_URI`, `SENTRY_SCOPES` | Redirect URI: `https://<api-host>/api/integrations/sentry/oauth/callback`; webhook: `https://<api-host>/api/webhooks/sentry/events` |
| Linear | OAuth2 PKCE or API key | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_REDIRECT_URI`, `LINEAR_SCOPES`, `LINEAR_WEBHOOK_SECRET` | Redirect URI: `https://<api-host>/api/integrations/linear/oauth/callback`; webhook: `https://<api-host>/api/webhooks/linear/events` |
| Microsoft Teams | OAuth2 PKCE or API key | `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_REDIRECT_URI`, `TEAMS_SCOPES`, `TEAMS_TENANT_ID`, `TEAMS_WEBHOOK_CLIENT_STATE` | Redirect URI: `https://<api-host>/api/integrations/teams/oauth/callback`; webhook: `https://<api-host>/api/webhooks/teams/events` |
| Jira | API-driven catalog integration | Per-connection site URL, email, API token, optional default project key and issue type | No platform webhook required for the baseline deploy path; catalog slug must remain published at `/api/integrations/catalog/jira` |

Notes:

- `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` is required anywhere connector credentials are stored
- Production and staging must use environment-specific callback hosts; never reuse staging redirect URIs in production provider apps
- Secrets stay in GitHub environments and Azure secret stores only; no plaintext connector credentials in repo config

## 5) Post-deploy verification checklist

Automated checks in the deploy workflow:

- backend `/health`
- connector route sweep for Slack, HubSpot, Stripe, Gmail, Sentry, Linear, and Teams
- connector catalog sweep for Slack, HubSpot, Stripe, Gmail, Sentry, Linear, Jira, and Microsoft Teams

Manual operator checks before closing a rollout:

1. Auth check: confirm the connector connect flow still redirects to the provider app or returns the expected auth challenge
2. Basic read: for a seeded staging account, verify one representative read call per connector
3. Basic write: verify one non-destructive write or draft operation where the provider supports it
4. Health signal: confirm the connector health endpoint or provider dashboard shows no new auth or webhook failures

## 6) Deployment proof

Every rollout comment should include:

- deployed environment URL
- backend image tag or commit SHA
- workflow run URL
- timestamp
- QA note stating whether automated connector smoke passed and whether manual connector checks were completed
