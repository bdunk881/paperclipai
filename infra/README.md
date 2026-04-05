# AutoFlow Infrastructure

All production services run on Azure (AKS). Only the marketing landing page is on Vercel.

## Stack

| Layer | Tool |
|---|---|
| Backend + Dashboard hosting | Azure AKS |
| Landing page | Vercel |
| Container registry | Azure ACR |
| TLS | Managed by Azure / Vercel |
| CI/CD | GitHub Actions |
| IaC | Terraform (Azure CAF) |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure AKS | `.github/workflows/deploy-azure.yml` |
| `frontend` (dashboard) | Azure AKS | `.github/workflows/deploy-azure.yml` |
| `landing` (marketing site) | Vercel | `.github/workflows/vercel.yml` |

## Authentication

GitHub Actions authenticates to Azure via **OIDC workload identity federation** — no static credentials or secrets stored anywhere.

| Setting | Value |
|---|---|
| App registration (client ID) | `1a18157f-bc97-4ad1-a170-1ebd3ae93968` |
| Tenant ID | `b1cb1311-760a-4c88-a778-5d2c227a1f45` |
| Subscription ID | `776a7226-e364-4cd9-a3e6-d083641af9ea` |
| Auth method | `azure/login@v2` with `id-token: write` permission |
| GitHub environments | `production` and `staging` (federated credentials for both) |

ACR login server, AKS cluster name, and resource group are discovered dynamically via `az` CLI at deploy time. No GitHub secrets needed for Azure.

## GitHub Actions secrets

### Azure

**None.** OIDC + dynamic discovery handles everything.

### Landing page (Vercel)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Workflows

| Workflow | Purpose | Trigger |
|---|---|---|
| `infra-deploy.yml` | Terraform plan/apply for Azure CAF | Manual (workflow_dispatch) |
| `deploy-azure.yml` | Build + push to ACR + deploy to AKS | Push to main / manual |
| `vercel.yml` | Deploy landing page to Vercel | Push to main (landing/**) / manual |
| `ci.yml` | Lint, test, build checks | Every PR |

## Deploying infrastructure (first time)

1. Go to **Actions → Deploy Azure Infrastructure → Run workflow**
2. Select `staging`, `apply`, and check `bootstrap` (first time only)
3. Once staging is confirmed, repeat for `production` (no bootstrap needed)

## Kubernetes manifests

K8s manifests in `k8s/staging/` and `k8s/production/` — applied automatically after Terraform.

## Daily operations

- **Deploy backend/dashboard:** merge to `main` → builds Docker images, pushes to ACR, deploys to AKS
- **Deploy landing page:** merge to `main` with changes under `landing/` → Vercel
- **Rollback:** `kubectl set image` to previous ACR tag, or redeploy previous commit SHA
