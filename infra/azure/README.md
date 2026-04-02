# AutoFlow — Azure Infrastructure (Primary Deploy Track)

Terraform IaC for the Azure-native deployment of AutoFlow.

> **Status:** Primary deployment path — AutoFlow runs on AKS (Azure Kubernetes Service) with ACR, Key Vault, Hub/Spoke VNets, and Azure Policy following the Cloud Adoption Framework.
> CI/CD is handled by `.github/workflows/deploy-azure.yml`.
>
> See `COMPARISON.md` for historical context on the Hetzner → Azure migration decision.

---

## Architecture

```
Internet
    │
    ▼
Azure Load Balancer (Standard)
    │
    ▼
AKS Cluster  ──────────────────────────────── VNet (10.0.0.0/16)
  ├── autoflow-staging namespace              ├── aks-subnet     (10.0.1.0/24)
  └── autoflow-production namespace           └── pe-subnet      (10.0.2.0/24)
         ↑ pulls images from
Azure Container Registry (Premium, private endpoint)
         ↑ pushed by
Azure DevOps Pipeline (.azure-pipelines/ci-cd.yml)

Observability:
  Application Insights + Log Analytics Workspace + Azure Monitor Alerts
```

---

## Prerequisites

1. **Azure CLI** ≥ 2.55: `az login` with an account that has `Contributor` + `User Access Administrator` on the target subscription.
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

| Module | Resources |
|---|---|
| `networking` | VNet, AKS subnet, PE subnet, NSG, Private DNS zone for ACR |
| `acr` | Azure Container Registry (Premium), private endpoint |
| `aks` | AKS cluster, Log Analytics workspace, ACR pull role assignment |
| `monitoring` | Application Insights, Log Analytics, metric alerts, availability test |

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
  bootstrap-tfstate.sh   — one-time Terraform remote state setup
```

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
