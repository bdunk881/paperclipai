# AutoFlow Infrastructure

Primary deployment path is now branch-driven GitHub Actions targeting Fly.io,
Supabase, and Cloudflare Pages.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Fly.io |
| Database + Auth | Supabase |
| Frontend hosting | Cloudflare Pages |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Managed by Fly.io and Cloudflare |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` dev | Fly.io | `.github/workflows/deploy-fly-fastapi-dev.yml` |
| `backend` staging | Fly.io | `.github/workflows/deploy-fly-fastapi-staging.yml` |
| `dashboard` | Cloudflare Pages | `.github/workflows/dashboard-cloudflare-pages.yml` |
| `docs` | Cloudflare Pages | `.github/workflows/docs-cloudflare-pages.yml` |
| `landing` | Cloudflare Pages | `.github/workflows/landing-cloudflare-pages.yml` |
| branch protection | GitHub Branch API | `.github/workflows/enforce-branch-protection.yml` |
| `observability rollups` | GitHub Actions + PostgreSQL | `.github/workflows/observability-rollups.yml` |
| `autoflow-brand` (planned) | GitHub + Cloudflare R2 + MemPalace | `infra/brand-assets/*` |

## Authentication

Deployment authentication is scoped to each target platform:

- Fly.io deployments use `FLY_API_TOKEN`.
- Cloudflare Pages deployments use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Backend runtime secrets are loaded from Infisical by the Fly container entrypoint.
- Dashboard Supabase access is supplied through environment-specific GitHub Actions secrets.

## GitHub Actions secrets required

Add these in the repo settings -> Secrets and variables -> Actions:

### Fly.io and Infisical

| Secret | Description |
|---|---|
| `FLY_API_TOKEN` | Fly deploy token used by both backend workflows |
| `INFISICAL_PROJECT_ID` | Infisical project id for the `autoflow` project; synced to Fly as `INFISICAL_PROJECT_ID` |
| `INFISICAL_TOKEN` | Environment-scoped Infisical service token; configure separately for the `dev` and `staging` GitHub environments |

The Fly apps should keep only `INFISICAL_TOKEN` and `INFISICAL_PROJECT_ID` as secrets.
Non-secret runtime values such as `APP_ENV`, `INFISICAL_ENV`, and allowed origins live in the Fly TOML files.

### Cloudflare Pages

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token used by the Pages workflows |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id used by the Pages workflows |
| `DEV_SUPABASE_URL` | Dev Supabase project URL used by dashboard builds |
| `DEV_SUPABASE_PUBLISHABLE_KEY` | Dev Supabase publishable key (`sb_publishable_*`) used by dashboard builds. Replaces the legacy `anon` JWT. |
| `PRODUCTION_SUPABASE_URL` | Shared staging/master Supabase project URL used by dashboard builds |
| `PRODUCTION_SUPABASE_PUBLISHABLE_KEY` | Shared staging/master publishable key used by dashboard builds |

### FastAPI Fly.io

| Secret / Variable | Description |
|---|---|
| `FLY_API_TOKEN` | Fly.io deploy token with access to the staging and production FastAPI apps |
| `FLY_STAGING_APP_NAME` | Optional override for the Fly app name |
| `FLY_STAGING_BASE_URL` | Optional override for the public Fly hostname used by smoke checks |
| `FLY_STAGING_SMOKE_USER_ID` | Optional user id sent through the staging smoke requests |
| `FLY_PRODUCTION_APP_NAME` | Optional override for the production Fly app name |
| `FLY_PRODUCTION_BASE_URL` | Optional override for the production Fly hostname used by smoke checks |
| `FLY_PRODUCTION_SMOKE_USER_ID` | Optional user id sent through production smoke requests |
| `FLY_PRODUCTION_RELAY_BASE_URL` | Optional direct backend host to relay callbacks/webhooks during a production cutover window; if omitted, the workflow uses `https://api.helloautoflow.com` |

## Daily operations

- **Deploy backend dev:** push to `dev` — `.github/workflows/deploy-fly-fastapi-dev.yml` deploys `autoflow-fastapi-dev`.
- **Deploy backend staging:** push to `staging` — `.github/workflows/deploy-fly-fastapi-staging.yml` deploys `autoflow-fastapi-staging`.
- **Promotion flow:** all feature work lands through PRs into `dev`, then `dev` promotes to `staging`, then `staging` promotes to `master`.
- **Deploy dashboard:** pushes and PRs with `dashboard/**` changes run `.github/workflows/dashboard-cloudflare-pages.yml`.
- **Deploy docs:** pushes and PRs with `docs/**` changes run `.github/workflows/docs-cloudflare-pages.yml`.
- **Deploy landing:** pushes and PRs with `landing/**` changes run `.github/workflows/landing-cloudflare-pages.yml`.
- **Enforce branch protection:** run `enforce-branch-protection.yml` to require CI on both protected branches, plus an extra `Staging-First Promotion Gate` and code-owner approval on `master`. Both branches disallow direct pushes, and `master` promotions must come from a PR whose head branch is exactly `staging`.
- **Rollback:** redeploy the last healthy Fly release for backend or re-run the previous Pages deployment for the affected frontend app.
## Protected Preview QA Access

- Set `QA_PREVIEW_ACCESS_TOKEN` only on the dashboard Vercel project's `preview` environment.
- Share QA links in the form `https://<preview-host>/agents?qaPreviewToken=<token>`.
- The dashboard validates the token through `/api/qa-preview-access`, seeds a temporary local auth user, and then unlocks the protected `/agents` routes for smoke testing.
- Do not set `QA_PREVIEW_ACCESS_TOKEN` on `production`.

## DNS

Recommended host split for the three-environment pipeline:

- `dev.helloautoflow.com` -> dev frontend target
- `staging.helloautoflow.com` -> staging frontend target
- `helloautoflow.com` -> production frontend target
- `api.helloautoflow.com` -> production backend target

Manage DNS through Cloudflare and keep production API records pointed at the active Fly.io backend target.

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`

## FastAPI Fly.io

- Workflow: `.github/workflows/deploy-fly-fastapi-staging.yml`
- Smoke script: `infra/scripts/fly_fastapi_smoke.sh`
- Runbook: `infra/runbooks/fly-fastapi-staging.md`

## Observability Rollups

- Migration: `migrations/013_observability_events.sql`
- Workflow: `.github/workflows/observability-rollups.yml`
- Maintenance script: `infra/scripts/run_observability_rollups.sh`

## Brand asset infra package (ALT-1363)

- IaC: `infra/brand-assets/terraform/cloudflare-r2/`
- Repo bootstrap: `infra/brand-assets/scripts/bootstrap_autoflow_brand_repo.sh`
- Publish script: `infra/brand-assets/scripts/publish_to_r2.sh`
- MemPalace sync: `infra/brand-assets/scripts/sync_brand_mempalace.sh`
- Workflow templates: `infra/brand-assets/workflows/`
- Operations runbook: `infra/runbooks/brand-assets-cdn-operations.md`
