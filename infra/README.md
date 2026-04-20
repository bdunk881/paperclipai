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
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Azure Static Web Apps deploy token |
| `VITE_API_BASE_URL` | Base URL for backend API (for example `https://api.autoflowapp.ai`) |
| `VITE_AZURE_CLIENT_ID` | Entra External ID app registration client ID |
| `VITE_AZURE_TENANT_SUBDOMAIN` | Tenant prefix before `.ciamlogin.com` (for example `autoflowciam`) |
| `BRANCH_ADMIN_TOKEN` | Admin-scoped GitHub token used by `enforce-branch-protection.yml` |

The SWA workflow maps `VITE_AZURE_CIAM_CLIENT_ID` and `VITE_AZURE_CIAM_TENANT_SUBDOMAIN` from
`VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_SUBDOMAIN` at build time.

## Daily operations

- **Deploy backend:** merge to `main` — GitHub Actions builds Docker images, pushes to ghcr.io, deploys to Azure.
- **Preview dashboard:** pull requests targeting `master` with `dashboard/` changes create/update SWA preview environments.
- **Deploy dashboard production:** push to `master` with `dashboard/` changes — GitHub Actions deploys to Azure Static Web Apps production.
- **Enforce branch protection:** run `enforce-branch-protection.yml` to require PR reviews plus CI gate(s) on `main`/`master`. Default required check is `Docker Build Check` with strict up-to-date enforcement.
- **Rollback:** redeploy a previous image tag (backend) or follow `infra/runbooks/swa-dashboard-deploy.md` for dashboard DNS/rollback.

## Infrastructure as Code

| Component | Path | Tool |
|-----------|------|------|
| Blob Storage | `infra/storage/` | Terraform |

## DNS

Configure DNS records to point to Azure per environment (dashboard uses SWA; landing uses Vercel).

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`
- Runbook: `infra/runbooks/qa-integration-environment.md`

## Brand asset infra package (ALT-1363)

- IaC: `infra/brand-assets/terraform/cloudflare-r2/`
- Repo bootstrap: `infra/brand-assets/scripts/bootstrap_autoflow_brand_repo.sh`
- Publish script: `infra/brand-assets/scripts/publish_to_r2.sh`
- MemPalace sync: `infra/brand-assets/scripts/sync_brand_mempalace.sh`
- Workflow templates: `infra/brand-assets/workflows/`
- Operations runbook: `infra/runbooks/brand-assets-cdn-operations.md`
