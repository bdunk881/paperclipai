# Runbook: Azure Static Web Apps Dashboard Deploy

> Legacy runbook. The production dashboard host `app.helloautoflow.com` currently belongs on Vercel, not Azure Static Web Apps.

## Purpose
Operate and troubleshoot dashboard deployments to Azure Static Web Apps (SWA).

## GitHub Secrets
Set these repository secrets before enabling `.github/workflows/deploy-swa.yml`:

- `AZURE_STATIC_WEB_APPS_API_TOKEN` for production (`app.helloautoflow.com`)
- `AZURE_STATIC_WEB_APPS_STAGING_API_TOKEN` for staging (`staging.app.helloautoflow.com`)
- `VITE_AZURE_CLIENT_ID`
- `VITE_AZURE_TENANT_SUBDOMAIN`
- `VITE_API_BASE_URL`

Optional staging overrides:

- `VITE_AZURE_CLIENT_ID_STAGING`
- `VITE_AZURE_TENANT_SUBDOMAIN_STAGING`
- `VITE_API_BASE_URL_STAGING`

## Trigger model
- Push to `master` touching `dashboard/**` triggers production SWA deploy.
- Push to `staging` touching `dashboard/**` triggers staging SWA deploy.
- Pull request previews stay on the Vercel-based dashboard preview workflow; `deploy-swa.yml` is branch-deploy only.

## Build artifact requirement

Azure Static Web Apps only honors `staticwebapp.config.json` when the file is present in the deployed app artifact. This workflow deploys `dashboard/dist`, so the build must render `dashboard/dist/staticwebapp.config.json` before upload. `npm run build:swa` handles this by templating `dashboard/staticwebapp.config.template.json` with the branch-specific `VITE_API_BASE_URL`.

## Provision the SWA resources via IaC

Use `infra/swa/main.bicep` for both production and staging so the setup stays reproducible.

Example staging deployment:

```bash
az deployment group create \
  --resource-group <rg-name> \
  --template-file infra/swa/main.bicep \
  --parameters \
    appName=autoflow-dashboard-staging \
    customDomain=staging.app.helloautoflow.com
```

After provisioning:

1. Add the SWA-generated validation record in DNS for `staging.app.helloautoflow.com`.
2. Wait for the custom domain to bind and certificate issuance to complete.
3. Generate the staging deployment token in Azure and store it as `AZURE_STATIC_WEB_APPS_STAGING_API_TOKEN`.

## DNS cutover checklist (`app.helloautoflow.com`)
1. Keep `app.helloautoflow.com` attached to the Vercel `dashboard` project.
2. Keep the authoritative DNS `app` CNAME pointed at `cname.vercel-dns.com`.
3. Do not repoint production dashboard traffic to Azure SWA unless there is an explicit rollback or migration decision covering auth, previews, and CIAM redirect URIs.
4. Verify HTTPS cert issuance and route health:
   - `/` returns `200`
   - `/login` returns `200` (SPA fallback)
   - `/auth/callback` returns `200` (SPA fallback used by MSAL redirect flow)
   - `/api/health` proxies to backend as expected
5. Sync the CIAM SPA redirect URIs so the app registration matches the deployed auth paths:
   ```bash
   cd infra/azure
   ./scripts/sync-ciam-redirect-uris.sh
   ```
   During the ALT-1542 migration window, keep both the host root and
   `/auth/callback` registered for production, staging, and the active preview
   hosts until the callback-route branch is fully merged and verified.

## Rollback
1. If production was temporarily moved to Azure SWA, restore the `app` CNAME to `cname.vercel-dns.com`.
2. Re-run Vercel deployment workflow if needed.
3. Confirm `https://app.helloautoflow.com` serves the expected Vercel build.

## Staging verification checklist (`staging.app.helloautoflow.com`)

1. Push a dashboard change to the `staging` branch.
2. Confirm `.github/workflows/deploy-swa.yml` runs against the staging branch.
3. Open `https://staging.app.helloautoflow.com/login` and verify the native auth login page loads.
4. Complete an Entra sign-in and confirm the redirect lands back on `https://staging.app.helloautoflow.com/auth/callback` or the SPA root flow without an origin mismatch.
5. Confirm API traffic uses the expected staging backend URL.

## Common failure modes
- Missing `AZURE_STATIC_WEB_APPS_API_TOKEN` or `AZURE_STATIC_WEB_APPS_STAGING_API_TOKEN`: deployment action fails authentication for the targeted branch.
- Missing `VITE_*` secrets: build succeeds with fallback/default auth settings; login may fail at runtime.
- Proxy route errors (`/api/*`): confirm `dashboard/dist/staticwebapp.config.json` exists in the deployed artifact, then confirm backend DNS/TLS and CORS policy for the SWA origin.
