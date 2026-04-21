# Runbook: Azure Static Web Apps Dashboard Deploy

> Legacy runbook. The production dashboard host `app.helloautoflow.com` currently belongs on Vercel, not Azure Static Web Apps.

## Purpose
Operate and troubleshoot dashboard deployments to Azure Static Web Apps (SWA).

## GitHub Secrets
Set these repository secrets before enabling `.github/workflows/deploy-swa.yml`:

- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `VITE_AZURE_CLIENT_ID`
- `VITE_AZURE_TENANT_SUBDOMAIN`
- `VITE_API_BASE_URL`

## Trigger model
- Push to `master` touching `dashboard/**` triggers production SWA deploy.
- Pull requests targeting `master` create/update preview environments.
- Closing a PR tears down the preview environment.

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

## Common failure modes
- Missing `AZURE_STATIC_WEB_APPS_API_TOKEN`: deployment action fails authentication.
- Missing `VITE_*` secrets: build succeeds with fallback/default auth settings; login may fail at runtime.
- Proxy route errors (`/api/*`): confirm backend DNS/TLS and CORS policy for SWA origin.
