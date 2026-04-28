# AutoFlow Infrastructure

Azure deployment with GitHub Actions CI/CD.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Azure (AKS / App Service) |
| Dashboard hosting | Azure Static Web Apps |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Managed by Azure |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure | `.github/workflows/deploy.yml` |
| `dashboard` | Azure Static Web Apps | `.github/workflows/deploy-swa.yml` |
| `dashboard` branch protection | GitHub Branch API | `.github/workflows/enforce-branch-protection.yml` |
| `landing` | Vercel | `.github/workflows/vercel.yml` |
| `autoflow-brand` (planned) | GitHub + Cloudflare R2 + MemPalace | `infra/brand-assets/*` |

## Authentication

### Backend (Azure)

GitHub Actions authenticates to Azure via **OIDC workload identity federation** — no static credentials stored as secrets.

| Setting | Value |
|---|---|
| App registration (client ID) | `1a18157f-bc97-4ad1-a170-1ebd3ae93968` |
| Tenant ID | `b1cb1311-760a-4c88-a778-5d2c227a1f45` |
| Auth method | `azure/login@v2` with `id-token: write` permission |

The federated credential is configured in the app registration under Certificates & secrets → Federated credentials. No `AZURE_CREDENTIALS` secret is needed.

## GitHub Actions secrets required

Add these in the repo settings -> Secrets and variables -> Actions:

### Dashboard (Azure Static Web Apps)

| Secret | Description |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Production Azure Static Web Apps deploy token (`app.helloautoflow.com`) |
| `AZURE_STATIC_WEB_APPS_STAGING_API_TOKEN` | Staging Azure Static Web Apps deploy token (`staging.app.helloautoflow.com`) |
| `VITE_API_BASE_URL` | Production backend API base URL (for example `https://api.autoflowapp.ai`) |
| `VITE_API_BASE_URL_STAGING` | Optional staging backend API base URL; falls back to `VITE_API_BASE_URL` |
| `VITE_AZURE_CLIENT_ID` | Production Entra External ID app registration client ID used for popup/browser auth |
| `VITE_AZURE_CLIENT_ID_STAGING` | Optional staging Entra client ID used for popup/browser auth; falls back to `VITE_AZURE_CLIENT_ID` |
| `VITE_AZURE_TENANT_SUBDOMAIN` | Production tenant prefix before `.ciamlogin.com` (for example `autoflowciam`) |
| `VITE_AZURE_TENANT_SUBDOMAIN_STAGING` | Optional staging tenant prefix; falls back to `VITE_AZURE_TENANT_SUBDOMAIN` |
| `BRANCH_ADMIN_TOKEN` | Admin-scoped GitHub token used by `enforce-branch-protection.yml` |

The SWA workflow no longer injects `VITE_AZURE_CIAM_CLIENT_ID` at build time. Native-auth requests are pinned in code to the CIAM public SPA app registration (`2dfd3a08-277c-4893-b07d-eca5ae322310`) so staging secrets cannot silently swap the flow onto a confidential client.
Runtime environment variables required in the Vercel dashboard project:

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL for backend API (for example `https://api.autoflowapp.ai`) |
| `VITE_AZURE_CIAM_CLIENT_ID` | Legacy override for preview/Vercel flows; native-auth code ignores this and stays pinned to the CIAM public SPA app |
| `VITE_AZURE_CIAM_TENANT_SUBDOMAIN` | Entra External ID tenant subdomain used for the `ciamlogin.com` authority host (for example `autoflowciam`) |
| `VITE_AZURE_CIAM_TENANT_DOMAIN` | Optional Entra External ID tenant domain path segment (for example `autoflowciam.onmicrosoft.com`) |
| `QA_PREVIEW_ACCESS_TOKEN` | Preview-only shared secret used by `/api/qa-preview-access` to unlock smoke-test access for protected dashboard routes |

## Daily operations

- **Deploy backend staging:** push to `staging` — `.github/workflows/deploy-azure.yml` builds the backend image, deploys the staging Container App, and runs the staging smoke checks.
- **Deploy backend production:** merge to `master` — `.github/workflows/deploy-azure.yml` builds the backend image, deploys AKS, and runs the production smoke checks.
- **Promotion flow:** agents open feature-branch PRs into `staging`; production promotion happens through a dedicated `staging` -> `master` PR after staging validation passes.
- **Preview dashboard:** non-production dashboard branches use `.github/workflows/dashboard-staging-gate.yml` to create Vercel preview deployments.
- **Deploy dashboard production:** push to `master` with `dashboard/` changes — GitHub Actions deploys to the production SWA host.
- **Deploy dashboard staging:** push to `staging` with `dashboard/` changes — GitHub Actions deploys to the staging SWA host.
- **Enforce branch protection:** run `enforce-branch-protection.yml` to require CI on both protected branches, plus an extra `Staging-First Promotion Gate` and code-owner approval on `master`. Both branches disallow direct pushes, and `master` promotions must come from a PR whose head branch is exactly `staging`.
- **Rollback:** redeploy a previous image tag (backend) or follow `infra/runbooks/swa-dashboard-deploy.md` for dashboard DNS/rollback.

## Infrastructure as Code

| Component | Path | Tool |
|-----------|------|------|
| Blob Storage | `infra/storage/` | Terraform |

## Protected Preview QA Access

- Set `QA_PREVIEW_ACCESS_TOKEN` only on the dashboard Vercel project's `preview` environment.
- Share QA links in the form `https://<preview-host>/agents?qaPreviewToken=<token>`.
- The dashboard validates the token through `/api/qa-preview-access`, seeds a temporary local auth user, and then unlocks the protected `/agents` routes for smoke testing.
- Do not set `QA_PREVIEW_ACCESS_TOKEN` on `production`.

## DNS

Configure DNS records to point to Azure per environment (dashboard uses SWA; landing uses Vercel).
Recommended dashboard host split:

- `app.helloautoflow.com` -> production SWA
- `staging.app.helloautoflow.com` -> staging SWA

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`
- Runbook: `infra/runbooks/qa-integration-environment.md`

## CIAM Native Auth Password Reset

- Enable tenant-side Email OTP SSPR before relying on `resetpassword/v1.0/*` in native auth.
- Script: `infra/azure/scripts/enable-ciam-native-auth-sspr.sh`
- Verification: `infra/azure/scripts/verify-ciam-native-auth-sspr.sh`
- Runbook: `infra/runbooks/ciam-native-auth-sspr.md`

## Brand asset infra package (ALT-1363)

- IaC: `infra/brand-assets/terraform/cloudflare-r2/`
- Repo bootstrap: `infra/brand-assets/scripts/bootstrap_autoflow_brand_repo.sh`
- Publish script: `infra/brand-assets/scripts/publish_to_r2.sh`
- MemPalace sync: `infra/brand-assets/scripts/sync_brand_mempalace.sh`
- Workflow templates: `infra/brand-assets/workflows/`
- Operations runbook: `infra/runbooks/brand-assets-cdn-operations.md`
