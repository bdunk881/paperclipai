# QA Integration Environment Runbook

## Purpose

Provision and verify the QA integration environment needed for auth + payment E2E evidence,
plus release-gate validation for analytics, performance, and browser coverage.

## QA Targets

- Dashboard integration QA target: `https://app.helloautoflow.com`
- Landing pre-release/performance target: `https://staging.helloautoflow.com`
- Landing production reference: `https://helloautoflow.com`

## API Health Probe Contract

Use the dashboard QA base URL plus any of the following equivalent endpoints:

- `/health` (primary canonical endpoint)
- `/api/health` (alias)
- `/api/status` (alias)

Expected response contract for all three endpoints:

- HTTP `200`
- JSON body with `status: "ok"`
- Includes summary fields: `templates`, `runs.total`, `runs.running`, `runs.completed`, `runs.failed`

## Required GitHub Actions Secrets

- `QA_API_BASE_URL` (required): stable dashboard base URL, example `https://app.helloautoflow.com`
- `QA_E2E_BEARER_TOKEN` (optional): bearer token for protected QA endpoints
- `QA_E2E_USER_ID` (optional): user identifier paired with the QA bearer token when a route expects a stable user context
- `STRIPE_WEBHOOK_SECRET` (optional, recommended): Stripe webhook signing secret
- `QA_CONNECTOR_HEALTH_SLUGS` (optional): space-delimited connector list for the Friday sweep; default `linear sentry hubspot teams apollo`

## Required Vercel Variables (Landing Analytics)

- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` (required for analytics script injection in `landing/app/layout.tsx`)
- `NEXT_PUBLIC_BASE_URL` should point at the active landing host under test (`https://staging.helloautoflow.com` for pre-release checks)

## Set Secrets

```bash
export GH_TOKEN="$GITHUB_API_KEY"

gh secret set QA_API_BASE_URL --body "https://app.helloautoflow.com"
# Optional
gh secret set QA_E2E_BEARER_TOKEN --body "<token>"
gh secret set STRIPE_WEBHOOK_SECRET --body "<whsec_...>"
```

Set landing analytics env vars in the Vercel project (`landing`), then redeploy:

```bash
vercel env add NEXT_PUBLIC_PLAUSIBLE_DOMAIN production
vercel env add NEXT_PUBLIC_PLAUSIBLE_DOMAIN preview
```

Configure dashboard preview access in the Vercel `dashboard` project:

```bash
vercel env add QA_PREVIEW_ACCESS_TOKEN preview
```

Then share preview smoke-test links in this format:

```text
https://<dashboard-preview-host>/agents?qaPreviewToken=<QA_PREVIEW_ACCESS_TOKEN>
```

The same tokenized link can be reused for:

- `/agents`
- `/agents/<templateId>`
- `/agents/deploy/<templateId>`
- `/agents/my`
- `/agents/activity`

## Run Evidence Workflow

1. Open GitHub Actions and run `QA Integration Evidence`.
2. Download artifact `qa-integration-evidence-<run_id>`.
3. Review the connector health rows in `summary.md` for:
- `200` healthy
- `206` degraded
- `503` route mounted but connector down/not configured for QA user
- `401/403` auth gap or insufficient token scopes
- `404/000` broken route or unreachable endpoint; file a connector regression ticket immediately
4. Attach the artifact summary to:

- [ALT-1071](/ALT/issues/ALT-1071)
- [ALT-1080](/ALT/issues/ALT-1080)

## Friday Connector Sweep Focus

The default Friday sweep probes these connector health endpoints:

- `/api/integrations/linear/health`
- `/api/integrations/sentry/health`
- `/api/integrations/hubspot/health`
- `/api/integrations/teams/health`
- `/api/integrations/apollo/health`

If you need to expand the sweep for P1 work, set `QA_CONNECTOR_HEALTH_SLUGS` to a space-delimited list before running the workflow.

## Performance + Browser Matrix (Landing)

1. Run Lighthouse against `https://staging.helloautoflow.com` (mobile + desktop profiles).
2. Use the following browser matrix for release gate sign-off:
- Chrome (latest)
- Safari (latest stable on macOS)
- Firefox (latest)
- Edge (latest)
3. Record pass/fail and notable regressions in the parent QA task.

## Troubleshooting

- If all probe statuses are `000`, verify `QA_API_BASE_URL` and Vercel domain accessibility.
- If probe statuses are `401/403`, provide `QA_E2E_BEARER_TOKEN` or run with auth bypass where allowed.
- If webhook checks fail, confirm `STRIPE_WEBHOOK_SECRET` is available from Stripe/Vercel integration.
