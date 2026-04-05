# AutoFlow Infrastructure

Azure (backend on AKS) + Vercel (dashboard) deployment with GitHub Actions CI/CD.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Azure AKS |
| Dashboard hosting | Vercel |
| Container registry | Azure ACR + GitHub Container Registry (ghcr.io) |
| TLS | Managed by Azure / Vercel |
| CI/CD | GitHub Actions |
| IaC | Terraform (Azure CAF) |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure AKS | `.github/workflows/deploy-azure.yml` |
| `frontend` | Azure AKS | `.github/workflows/deploy-azure.yml` |
| `dashboard` | Vercel | `.github/workflows/vercel.yml` |

## Authentication

GitHub Actions authenticates to Azure via **OIDC workload identity federation** — no static credentials stored as secrets.

| Setting | Value |
|---|---|
| App registration (client ID) | `1a18157f-bc97-4ad1-a170-1ebd3ae93968` |
| Tenant ID | `b1cb1311-760a-4c88-a778-5d2c227a1f45` |
| Subscription ID | `776a7226-e364-4cd9-a3e6-d083641af9ea` |
| Auth method | `azure/login@v2` with `id-token: write` permission |
| GitHub environment | `production` (required for federated credential subject match) |

The federated credential is configured in the app registration under Certificates & secrets → Federated credentials.

## GitHub Actions secrets required

Add these in the repo settings → Secrets and variables → Actions:

### Backend (Azure)

| Secret | Description |
|---|---|
| `AZURE_ACR_LOGIN_SERVER` | ACR login server, e.g. `autoflowacr.azurecr.io` |
| `AKS_RESOURCE_GROUP` | Resource group containing the AKS cluster |
| `AKS_CLUSTER_NAME` | AKS cluster name |

No `AZURE_CREDENTIALS` secret needed — OIDC handles auth.

### Dashboard (Vercel)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Kubernetes manifests

K8s manifests are in `k8s/`:

```
k8s/
├── staging/
│   ├── namespace.yaml
│   ├── backend.yaml
│   ├── frontend.yaml
│   └── ingress.yaml
└── production/
    ├── namespace.yaml
    ├── backend.yaml
    ├── frontend.yaml
    └── ingress.yaml
```

## Terraform (Azure CAF)

Full IaC in `infra/azure/` — see `infra/azure/README.md` for architecture, prerequisites, and apply instructions.

## Daily operations

- **Deploy backend:** merge to `main` — GitHub Actions builds Docker images, pushes to ACR, deploys to AKS staging, then production (with approval gate).
- **Deploy dashboard:** merge to `main` with changes under `dashboard/` — GitHub Actions deploys to Vercel.
- **Rollback backend:** `kubectl set image` to a previous ACR tag, or redeploy a previous commit SHA.
- **Rollback dashboard:** Vercel dashboard → Deployments → Promote previous deploy.

## DNS

Configure DNS records to point to Azure and Vercel per environment.
