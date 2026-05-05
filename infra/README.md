# AutoFlow Infrastructure

Infrastructure docs for the current deployment stack plus the legacy Azure
estate being retired under [ALT-2325](/ALT/issues/ALT-2325), including the
standalone FastAPI staging service on Fly.io.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Active non-Azure target plus Fly.io FastAPI staging and legacy Azure teardown track |
| Dashboard hosting | Vercel (production) |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Platform-managed by active hosts |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Legacy Azure path pending retirement | `.github/workflows/deploy.yml` |
| `fastapi-staging` | Fly.io | `.github/workflows/deploy-fly-fastapi-staging.yml` |
| `dashboard` | Vercel | `.github/workflows/vercel.yml` |
| `dashboard` branch protection | GitHub Branch API | `.github/workflows/enforce-branch-protection.yml` |
| `landing` | Vercel | `.github/workflows/vercel.yml` |
| `observability rollups` | GitHub Actions + PostgreSQL | `.github/workflows/observability-rollups.yml` |
| `autoflow-brand` (planned) | GitHub + Cloudflare R2 + MemPalace | `infra/brand-assets/*` |

## Phase 5 decommission

Use [`infra/runbooks/azure-cutover-decommission.md`](runbooks/azure-cutover-decommission.md)
as the source of truth for the final DNS cutover, Azure destroy sequence, CIAM
cleanup, and subscription shutdown. Azure-specific docs in this directory should
be treated as legacy references unless that runbook explicitly points to them.

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

### FastAPI staging (Fly.io)

| Secret / Variable | Description |
|---|---|
| `FLY_API_TOKEN` | App-scoped Fly.io deploy token for `autoflow-fastapi-staging` |
| `FLY_STAGING_APP_NAME` | Optional override for the Fly app name |
| `FLY_STAGING_BASE_URL` | Optional override for the public Fly hostname used by smoke checks |
| `FLY_STAGING_SMOKE_USER_ID` | Optional user id sent through the staging smoke requests |

## Daily operations

- **Deploy backend staging:** legacy Azure path only while teardown remains incomplete — `.github/workflows/deploy-azure.yml` builds the backend image, deploys the staging Container App, and runs the staging smoke checks.
- **Deploy backend production:** treat `.github/workflows/deploy-azure.yml` as a legacy path during the ALT-2325 cutover window; do not use it as the default production source of truth after the non-Azure API cutover completes.
- **Deploy FastAPI staging service:** push to `staging` with `backend/**`, `docker/backend/Dockerfile`, `fly.toml`, or `infra/scripts/fly_fastapi_smoke.sh` changes — `.github/workflows/deploy-fly-fastapi-staging.yml` deploys `autoflow-fastapi-staging` on Fly.io and runs live knowledge-API smoke checks.
- **Promotion flow:** agents open feature-branch PRs into `staging`; production promotion happens through a dedicated `staging` -> `master` PR after staging validation passes.
- **Preview dashboard:** non-production dashboard branches use `.github/workflows/dashboard-staging-gate.yml` to create Vercel preview deployments.
- **Deploy dashboard production:** push to `master` with `dashboard/` changes — GitHub Actions deploys the Vercel production path.
- **Deploy dashboard staging:** push to `staging` with `dashboard/` changes — use the preview/staging workflow that matches the current non-Azure frontend target.
- **Enforce branch protection:** run `enforce-branch-protection.yml` to require CI on both protected branches, plus an extra `Staging-First Promotion Gate` and code-owner approval on `master`. Both branches disallow direct pushes, and `master` promotions must come from a PR whose head branch is exactly `staging`.
- **Rollback:** use the active platform rollback flow for the current host; Azure Static Web Apps rollback steps in `infra/runbooks/swa-dashboard-deploy.md` are historical only.

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

DNS should reflect the active non-Azure production targets. Use
[`infra/runbooks/azure-cutover-decommission.md`](runbooks/azure-cutover-decommission.md)
to verify and remove any remaining Azure-bound records during Phase 5.

## Cloudflare Pages migration

- Phase 4 cutover runbook: `infra/runbooks/cloudflare-pages-phase4-cutover.md`
- Scope: Pages project validation, env/secret requirements, DNS cutover order, and Vercel retirement sequence for `app.helloautoflow.com`, `docs.helloautoflow.com`, `helloautoflow.com`, and `www.helloautoflow.com`

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`
- Runbook: `infra/runbooks/qa-integration-environment.md`
- Tier 1 release path: `infra/runbooks/tier1-connector-release.md`

## FastAPI Fly.io staging

- Workflow: `.github/workflows/deploy-fly-fastapi-staging.yml`
- Smoke script: `infra/scripts/fly_fastapi_smoke.sh`
- Runbook: `infra/runbooks/fly-fastapi-staging.md`

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
