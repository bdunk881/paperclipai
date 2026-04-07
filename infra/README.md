# AutoFlow Infrastructure

Azure Container Apps (backend) + Vercel (landing page) deployment with GitHub Actions CI/CD.

## Stack

| Layer | Tool |
|---|---|
| Backend hosting | Azure Container Apps |
| Landing page hosting | Vercel |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Managed by Azure Container Apps |
| IaC | Terraform (`infra/terraform/`) |
| CI/CD | GitHub Actions |

## Services

| App | Platform | Workflow |
|---|---|---|
| `backend` | Azure Container Apps | `.github/workflows/deploy.yml` |
| `landing` | Vercel | `.github/workflows/vercel.yml` |

## Terraform structure

```
infra/terraform/
├── providers.tf          # AzureRM + AzureAD providers (OIDC auth)
├── variables.tf          # All input variables
├── main.tf               # Resource group, VNet, managed identity, OIDC federation
├── database.tf           # PostgreSQL Flexible Server + private DNS
├── cache.tf              # Redis Cache + private endpoint
├── storage.tf            # Storage account + blob containers
├── keyvault.tf           # Key Vault + access policies
├── container_apps.tf     # Container Apps environment + backend app
├── outputs.tf            # Key output values for CI/CD
└── environments/
    ├── staging.tfvars     # Staging variable values
    ├── staging.backend    # Staging remote state config
    ├── production.tfvars  # Production variable values
    └── production.backend # Production remote state config
```

## One-time bootstrap (run once per subscription)

Before the first `terraform init`, create the Terraform state storage account:

```bash
# Login as a Subscription Owner or Contributor
az login

LOCATION="eastus2"
RG="rg-autoflow-tfstate"
SA="stautoflowterraform"   # must be globally unique; adjust if taken

az group create -n $RG -l $LOCATION

az storage account create \
  -n $SA -g $RG -l $LOCATION \
  --sku Standard_LRS \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false

az storage container create -n tfstate --account-name $SA
```

After the first `terraform apply`, store the GitHub PAT for ghcr.io pulls:

```bash
# Create a PAT at https://github.com/settings/tokens with read:packages scope
az keyvault secret set \
  --vault-name "kv-autoflow-staging" \
  --name "GHCR-PAT" \
  --value "<your-github-pat>"
```

## GitHub Actions repository variables (Actions > Variables, not Secrets)

Set these at the repo level or per GitHub environment (`staging` / `production`).
These are non-sensitive OIDC identifiers — no passwords stored in GitHub.

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | Output `github_actions_client_id` from `terraform output` |
| `AZURE_TENANT_ID` | Output `tenant_id` from `terraform output` |
| `AZURE_SUBSCRIPTION_ID` | Output `subscription_id` from `terraform output` |

### Dashboard (Vercel)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Daily operations

- **Deploy backend:** merge to `main` — GitHub Actions builds Docker images, pushes
  to ghcr.io, then updates the Container App revision.
- **Deploy to production:** push a version tag (`v*`) — the deploy workflow gates on
  the tag ref and targets the production Container App.
- **Rollback:** set the Container App active revision to any previous image tag:
  ```bash
  az containerapp revision list -n ca-autoflow-staging-backend -g rg-autoflow-staging
  az containerapp revision activate -n ca-autoflow-staging-backend \
    -g rg-autoflow-staging --revision <revision-name>
  ```
- **Plan infra changes:** open a PR touching `infra/terraform/**` — `infra-deploy.yml`
  auto-runs `terraform plan`.
- **Apply infra changes:** trigger `infra-deploy.yml` manually with `action=apply`.

## DNS

Configure a CNAME from your domain to the Container App FQDN
(`terraform output container_app_fqdn`). Azure Container Apps handles TLS automatically.
