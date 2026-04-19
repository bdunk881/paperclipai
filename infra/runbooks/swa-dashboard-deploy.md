# Runbook: Azure Static Web Apps Dashboard Deploy

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
1. In Azure Static Web Apps, add custom domain `app.helloautoflow.com`.
2. Add the TXT validation record provided by Azure DNS validation.
3. Replace current CNAME target (`cname.vercel-dns.com`) with SWA hostname (`<swa-default-hostname>`).
4. Verify HTTPS cert issuance and route health:
   - `/` returns `200`
   - `/login` returns `200` (SPA fallback)
   - `/api/health` proxies to backend as expected

## Rollback
1. Revert CNAME from SWA hostname back to `cname.vercel-dns.com`.
2. Re-run Vercel deployment workflow if needed.
3. Confirm `https://app.helloautoflow.com` serves expected Vercel build.

## Common failure modes
- Missing `AZURE_STATIC_WEB_APPS_API_TOKEN`: deployment action fails authentication.
- Missing `VITE_*` secrets: build succeeds with fallback/default auth settings; login may fail at runtime.
- Proxy route errors (`/api/*`): confirm backend DNS/TLS and CORS policy for SWA origin.
