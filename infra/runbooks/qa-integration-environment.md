# QA Integration Environment Runbook

## Purpose

Provision and verify the QA integration environment needed for auth + payment E2E evidence.

## Required GitHub Actions Secrets

- `QA_API_BASE_URL` (required): stable dashboard base URL, example `https://app.helloautoflow.com` (the smoke script handles optional `/api` prefix)
- `QA_E2E_BEARER_TOKEN` (optional): bearer token for protected QA endpoints
- `STRIPE_WEBHOOK_SECRET` (optional, recommended): Stripe webhook signing secret

## Set Secrets

```bash
export GH_TOKEN="$GITHUB_API_KEY"

gh secret set QA_API_BASE_URL --body "https://app.helloautoflow.com"
# Optional
gh secret set QA_E2E_BEARER_TOKEN --body "<token>"
gh secret set STRIPE_WEBHOOK_SECRET --body "<whsec_...>"
```

## Run Evidence Workflow

1. Open GitHub Actions and run `QA Integration Evidence`.
2. Download artifact `qa-integration-evidence-<run_id>`.
3. Attach the artifact summary to:

- [ALT-1071](/ALT/issues/ALT-1071)
- [ALT-1080](/ALT/issues/ALT-1080)

## Troubleshooting

- If all probe statuses are `000`, verify `QA_API_BASE_URL` and Vercel domain accessibility.
- If probe statuses are `401/403`, provide `QA_E2E_BEARER_TOKEN` or run with auth bypass where allowed.
- If webhook checks fail, confirm `STRIPE_WEBHOOK_SECRET` is available from Stripe/Vercel integration.
