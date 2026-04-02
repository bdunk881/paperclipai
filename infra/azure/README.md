# AutoFlow — Azure Infrastructure (Alternative Track)

Terraform IaC for an Azure-native deployment of AutoFlow.

> **Status:** Draft / alternative track — the primary deployment path is
> Hetzner + Coolify (see `infra/README.md`). This directory is additive;
> do not modify the Hetzner setup.
>
> See `COMPARISON.md` for a detailed cost/complexity trade-off analysis.

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

## Azure DevOps Pipeline

The pipeline lives at `.azure-pipelines/ci-cd.yml`.

**Stages:**

| Stage | Trigger | Gate |
|---|---|---|
| Build | Every push | CI pass (lint + tests) |
| Deploy Staging | `main` branch only | Automatic after Build |
| Deploy Production | `main` branch only | Manual approval in Azure DevOps |

**Setup steps:**

1. Create a Variable Group named `autoflow-pipeline-vars` in Azure DevOps → Pipelines → Library.
2. Add a service connection named `autoflow-azure-sc` (Azure Resource Manager).
3. Add a service connection named `autoflow-acr-sc` (Docker Registry → ACR).
4. Create two Environments in Azure DevOps → Pipelines → Environments:
   - `autoflow-staging` — no approvals
   - `autoflow-production` — add an Approvals & Checks policy with required approvers

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

After `terraform apply`, export these values and add them to Azure DevOps / app secrets:

```bash
terraform output app_insights_connection_string   # APPLICATIONINSIGHTS_CONNECTION_STRING
terraform output acr_login_server                 # Docker registry for pipeline
terraform output kube_config_command              # merge kubeconfig
```
