# AutoFlow Infrastructure

Azure deployment with GitHub Actions CI/CD.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Azure (AKS / App Service) |
| Dashboard hosting | Vercel |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Managed by Vercel (dashboard/landing), Azure (backend APIs) |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure | `.github/workflows/deploy.yml` |
| `dashboard` | Vercel | `.github/workflows/dashboard-staging-gate.yml` |
| `dashboard` branch protection | GitHub Branch API | `.github/workflows/enforce-branch-protection.yml` |
| `landing` | Vercel | `.github/workflows/vercel.yml` |
| `observability rollups` | GitHub Actions + PostgreSQL | `.github/workflows/observability-rollups.yml` |
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

### Dashboard (Vercel)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel token used by dashboard deploy workflows |
| `VERCEL_ORG_ID` | Team ID for the dashboard Vercel project |
| `VERCEL_PROJECT_ID` | Dashboard Vercel project ID |
| `BRANCH_ADMIN_TOKEN` | Admin-scoped GitHub token used by `enforce-branch-protection.yml` |

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
- **Deploy dashboard staging:** push to `staging` with `dashboard/` changes — GitHub Actions deploys to Vercel and aliases the resulting deployment to `staging.app.helloautoflow.com`.
- **Deploy dashboard production:** push to `master` with `dashboard/` changes — GitHub Actions deploys to the Vercel production host `app.helloautoflow.com`.
- **Enforce branch protection:** run `enforce-branch-protection.yml` to require CI on both protected branches, plus an extra `Staging-First Promotion Gate` and code-owner approval on `master`. Both branches disallow direct pushes, and `master` promotions must come from a PR whose head branch is exactly `staging`.
- **Rollback:** redeploy a previous image tag (backend) or follow `infra/runbooks/vercel-production-deploy.md` for dashboard DNS/rollback.

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

Configure dashboard and landing DNS records to point to Vercel. Keep backend API hosts on Azure.
Recommended dashboard host split:

- `app.helloautoflow.com` -> Vercel `dashboard` project production deployment
- `staging.app.helloautoflow.com` -> Vercel `dashboard` project `staging` branch alias

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`
- Runbook: `infra/runbooks/qa-integration-environment.md`
- Tier 1 release path: `infra/runbooks/tier1-connector-release.md`

## Observability Rollups

- Migration: `migrations/013_observability_events.sql`
- Workflow: `.github/workflows/observability-rollups.yml`
- Maintenance script: `infra/scripts/run_observability_rollups.sh`
- Runbook: `infra/runbooks/observability-postgres-rollups.md`

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
