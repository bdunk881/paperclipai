# AutoFlow Infrastructure

Azure (backend) + Vercel (dashboard) deployment with GitHub Actions CI/CD.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Azure (AKS / App Service) |
| Dashboard hosting | Vercel |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Managed by Azure / Vercel |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure | `.github/workflows/deploy.yml` |
| `dashboard` | Vercel | `.github/workflows/vercel.yml` |

## GitHub Actions secrets required

Add these in the repo settings -> Secrets and variables -> Actions:

### Backend (Azure)

Configured per Azure deployment method (AKS credentials, App Service publish profile, etc.).

### Dashboard (Vercel)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

Runtime environment variables required in the Vercel dashboard project:

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL for backend API (for example `https://api.autoflowapp.ai`) |
| `VITE_AZURE_CIAM_CLIENT_ID` | Entra External ID app registration client ID |
| `VITE_AZURE_CIAM_TENANT_SUBDOMAIN` | Tenant prefix before `.ciamlogin.com` (for example `autoflowciam`) |

## Daily operations

- **Deploy backend:** merge to `main` — GitHub Actions builds Docker images, pushes to ghcr.io, deploys to Azure.
- **Deploy dashboard:** merge to `main` with changes under `dashboard/` — GitHub Actions deploys to Vercel.
- **Rollback:** redeploy a previous image tag (backend) or use Vercel's instant rollback (dashboard).

## DNS

Configure DNS records to point to Azure and Vercel per environment.

## QA Integration Evidence

- Workflow: `.github/workflows/qa-integration-evidence.yml`
- Smoke script: `infra/scripts/qa_integration_smoke.sh`
- Runbook: `infra/runbooks/qa-integration-environment.md`
