# AutoFlow — Azure Infrastructure (Primary Deploy Track)

Terraform IaC for the Azure-native deployment of AutoFlow.

> **Status:** Primary deployment path — AutoFlow runs on AKS (Azure Kubernetes Service) with ACR, Key Vault, Hub/Spoke VNets, and Azure Policy following the Cloud Adoption Framework.
> CI/CD is handled by `.github/workflows/deploy-azure.yml`.
>
> See `COMPARISON.md` for historical context on the Hetzner → Azure migration decision.

---

## Architecture

Hub-and-spoke topology following Azure Cloud Adoption Framework (CAF).
See [`ARCHITECTURE.md`](ARCHITECTURE.md) for full topology diagrams, network addressing table, module dependency graph, and security traffic flow.

```
                        Internet
                           │
               ┌───────────▼───────────┐
               │     Azure Firewall    │  ← Hub VNet 10.1.0.0/16
               │     + Key Vault       │
               └─────────┬─────────────┘
             VNet peering │ (bidirectional)
        ┌─────────────────┼────────────────┐
        │                                  │
 Prod Spoke (10.2.0.0/16)       Staging Spoke (10.3.0.0/16)
   └── AKS cluster (prod)          └── AKS cluster (staging)
   └── ACR private endpoint        └── ACR private endpoint
```

---

## Prerequisites

1. **Azure CLI** ≥ 2.55: `az login` with an account that has `Contributor` + `User Access Administrator` + `Management Group Contributor` on the target subscription/tenant root.
2. **Terraform** ≥ 1.6: `brew install terraform` or via [tfenv](https://github.com/tfutils/tfenv).
3. **Bootstrap remote state** (one-time, per subscription):

```bash
./scripts/bootstrap-tfstate.sh
```

This creates the `autoflow-tfstate-rg` resource group, the `autoflowterraformstate` storage account, and the `tfstate` container used by the Terraform backend.

---

## Usage

### Staging

```bash
cd infra/azure
terraform init
terraform workspace new staging   # first time only
terraform workspace select staging
terraform apply -var="environment=staging" -var="alert_email=ops@helloautoflow.com"
```

### Production

```bash
terraform workspace new production   # first time only
terraform workspace select production
terraform apply \
  -var="environment=production" \
  -var="alert_email=ops@helloautoflow.com" \
  -var="node_count=3" \
  -var="min_node_count=2" \
  -var="max_node_count=10"
```

---

## Module overview

| Module | Path | Key Resources |
|---|---|---|
| `hub` | `modules/hub` | Hub VNet, Azure Firewall, Azure Bastion, Key Vault, private DNS zones |
| `spoke` | `modules/spoke` | Spoke VNet, subnets, route table (UDR → Firewall), VNet peering |
| `acr` | `modules/acr` | Azure Container Registry (Premium), private endpoint |
| `aks` | `modules/aks` | AKS cluster, node pools, Log Analytics workspace, kubelet identity |
| `management` | `modules/management` | Management Group hierarchy, RBAC, Key Vault access policies |
| `monitoring` | `modules/monitoring` | Application Insights, Log Analytics, metric alert rules |
| `policy` | `modules/policy` | Azure Policy initiative, MG-scoped assignment, location guardrails |
| `security` | `modules/security` | Defender for Containers/KeyVaults, security contact, auto-provisioning, diagnostic export |
| `networking` (legacy) | `modules/networking` | Superseded by hub + spoke. Retained for reference. |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full module dependency graph.

---

## GitHub Actions CI/CD Pipeline

The pipeline lives at `.github/workflows/deploy-azure.yml`.

**Stages:**

| Stage | Trigger | Gate |
|---|---|---|
| Build & Push | Every push to `master` | CI pass (lint + tests) |
| Deploy Production | Push to `master` | GitHub `production` environment gate |
| Deploy Staging | Manual `workflow_dispatch` | No approval gate by default |

The GitHub deploy paths are split by environment:

- `staging` stays on **Azure Container Apps**
- `production` rolls the backend workload onto **AKS**

Terraform still provisions the broader Azure estate. The production deploy path
imports the built backend image into the production ACR, bootstraps
`autoflow-backend-secrets`, applies the AKS backend manifest, and updates the
`backend` deployment image in `autoflow-production`.

Because GitHub-hosted runner IPs are highly dynamic, production Terraform does
not enforce AKS API authorized IP ranges by default. As of 2026-04-25, GitHub's
official `GET /meta` response advertises thousands of Actions CIDRs, while AKS
authorized IP ranges support only up to 200 entries. Re-enable the production
allowlist only after moving deploys to stable egress such as self-hosted runners,
GitHub larger runners with static IPs, or a dedicated VPN/NAT path.

**Required GitHub repository variables:**

| Variable | Description |
|---|---|
| `ARM_CLIENT_ID` | Azure federated credential client ID used by `azure/login@v2` |
| `ARM_TENANT_ID` | Azure tenant ID |
| `ARM_SUBSCRIPTION_ID` | Azure subscription ID |

**Required GitHub environment variables:**

| Environment | Variable | Description |
|---|---|---|
| `staging` | `AZURE_CONTAINER_APP_STAGING_NAME` | Expected staging backend Container App name |
| `staging` | `AZURE_CONTAINER_APP_STAGING_RESOURCE_GROUP` | Resource group for the staging backend app |
| `staging` | `AZURE_STAGING_API_HOST` | Public staging API hostname used for DNS-based discovery |
| `production` | `AZURE_AKS_PRODUCTION_CLUSTER_NAME` | Production AKS cluster name |
| `production` | `AZURE_AKS_PRODUCTION_RESOURCE_GROUP` | Resource group containing the production AKS cluster |
| `production` | `AZURE_PRODUCTION_API_HOST` | Public production API hostname used for DNS and cutover tracking |

**Required GitHub environment secrets:**

| Environment | Secret | Description |
|---|---|---|
| `production` | `AZURE_BACKEND_ENV_PRODUCTION` | Newline-delimited env file materialized into the `autoflow-backend-secrets` Kubernetes secret |

**Setup steps:**

1. Run `terraform apply` to create all Azure resources (see Usage above).
2. Add the repository-level OIDC variables listed above.
3. Create two GitHub Environments in Settings → Environments:
   - `staging` — no approvals
   - `production` — add required reviewers for the production deployment gate
4. Add the environment-scoped backend target variables for each environment.
5. Add `AZURE_BACKEND_ENV_PRODUCTION` to the `production` environment so the
   AKS rollout can create `autoflow-backend-secrets` before the deployment starts.
6. Verify production-specific values do not reference `staging` or `nonprod`
   resource names; the workflow now hard-fails on cross-environment targets.

**Validation checks**

- `gh api repos/<owner>/<repo>/environments` should show a `production`
  protection rule with required reviewers before production deploys are allowed.
- `gh api repos/<owner>/<repo>/environments/production/variables` should include
  the three production AKS variables listed above.
- `gh run list --workflow deploy-azure.yml` should show a successful
  production backend run that imports into ACR, creates the K8s secret, and
  rolls out the AKS deployment before you cut traffic to the new backend.

---

## Key variables

| Variable | Default | Notes |
|---|---|---|
| `prefix` | `autoflow` | Used in all resource names |
| `environment` | — | `staging` or `production` |
| `location` | `eastus2` | Azure region |
| `node_vm_size` | `Standard_B2s` | 2 vCPU, 4 GB RAM — suitable for early-stage |
| `min_node_count` | `1` | Scale to zero not supported on system node pool |
| `max_node_count` | `5` | Adjust based on load |
| `kubernetes_version` | `1.29` | Check `az aks get-versions` for latest |
| `api_server_authorized_ips` | `["10.1.3.0/24"]` | Stable CIDRs only. Applied to staging; production is intentionally left open until CI uses stable egress. |

---

## Scripts

```
infra/azure/scripts/
  bootstrap-tfstate.sh         — one-time Terraform remote state setup
  provision-ciam.sh            — create the CIAM SPA app registration and output env vars
  sync-ciam-redirect-uris.sh   — upsert the dashboard auth callback/logout URIs on the CIAM SPA app
  validate-ciam-prereqs.sh     — validate subscription + Graph access before provisioning
```

The dashboard is in a transition period between root-based MSAL redirects and
`${window.location.origin}/auth/callback`. Until that migration is fully merged
and verified, keep both the host root and `/auth/callback` registered as SPA
redirect URIs for production, staging, the active Vercel preview hosts, and
localhost. Run `./scripts/sync-ciam-redirect-uris.sh` after any custom-domain
cutover, preview-host policy change, or auth route change.

---

## Secrets needed post-deploy

After `terraform apply`, export these values and wire them into the deployment
systems that consume them:

```bash
terraform output app_insights_connection_string   # APPLICATIONINSIGHTS_CONNECTION_STRING
terraform output kube_config_command              # optional operator access for AKS troubleshooting
```

For backend deploy automation, capture the resulting Container App names,
resource groups, and public hostnames and store them in the environment-scoped
GitHub variables documented above.
