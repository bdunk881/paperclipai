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
| Build & Push | Every push to `main` | CI pass (lint + tests) |
| Deploy Staging | `main` branch only | Automatic after Build |
| Deploy Production | `main` branch only | Manual approval via GitHub environment protection |

**Required GitHub Secrets (board must add):**

| Secret | Description |
|---|---|
| `AZURE_CREDENTIALS` | Service principal JSON from `az ad sp create-for-rbac --sdk-auth` |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_ACR_LOGIN_SERVER` | ACR login server, e.g. `autoflowacr.azurecr.io` |
| `AKS_CLUSTER_NAME` | AKS cluster name (Terraform output: `aks_cluster_name`) |
| `AKS_RESOURCE_GROUP` | Resource group name (Terraform output: `resource_group_name`) |

**Setup steps:**

1. Run `terraform apply` to create all Azure resources (see Usage above).
2. Add the GitHub Secrets listed above to the repository.
3. Create two GitHub Environments in Settings → Environments:
   - `staging` — no approvals
   - `production` — add required reviewers for manual approval gate

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

---

## Scripts

```
infra/azure/scripts/
  bootstrap-tfstate.sh      — one-time Terraform remote state setup
  provision-ciam.sh         — create the CIAM SPA app registration and output env vars
  sync-ciam-redirect-uris.sh — upsert the dashboard auth callback/logout URIs on the CIAM SPA app
  validate-ciam-prereqs.sh  — validate subscription access, Graph access, and CIAM tenant-local automation access
```

For hosted-sign-in branding and a custom auth host such as
`auth.helloautoflow.com`, follow the runbook at
`../runbooks/entra-external-id-branding-and-custom-domain.md`. Microsoft Entra
External ID custom auth domains require both external-tenant domain verification
and Azure Front Door in front of `<tenant>.ciamlogin.com`.

---

## Secrets needed post-deploy

After `terraform apply`, export these values and add them to GitHub Secrets / app environment:

```bash
terraform output app_insights_connection_string   # APPLICATIONINSIGHTS_CONNECTION_STRING
terraform output acr_login_server                 # AZURE_ACR_LOGIN_SERVER
terraform output aks_cluster_name                 # AKS_CLUSTER_NAME
terraform output resource_group_name              # AKS_RESOURCE_GROUP
terraform output kube_config_command              # run to merge kubeconfig locally
```
