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
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Daily operations

- **Deploy backend:** merge to `main` — GitHub Actions builds Docker images, pushes to ghcr.io, deploys to Azure.
- **Deploy dashboard:** merge to `main` with changes under `dashboard/` — GitHub Actions deploys to Vercel.
- **Rollback:** redeploy a previous image tag (backend) or use Vercel's instant rollback (dashboard).

## DNS

Configure DNS records to point to Azure and Vercel per environment.
