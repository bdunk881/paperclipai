# Azure Blob Storage — AutoFlow

Terraform-managed Azure Blob Storage for centralized file storage across AutoFlow's automated businesses.

## Containers

| Container | Purpose | Examples |
|-----------|---------|----------|
| `content-pipeline` | Generated content and automation outputs | Social media posts, scheduled content, pipeline artifacts |
| `media-assets` | Images, videos, and templates | Pexels downloads, branded assets, design templates |
| `exports` | Reports and data exports | CRM snapshots, analytics exports, billing reports |
| `backups` | Configuration and database backups | Config snapshots, database dumps, state files |

## Naming Conventions

Blobs should follow this path structure:

```
<container>/<domain>/<YYYY>/<MM>/<descriptive-filename>
```

Examples:
- `content-pipeline/social/2026/04/instagram-post-batch-042.json`
- `media-assets/templates/2026/04/story-template-v2.png`
- `exports/crm/2026/04/attio-contacts-export.csv`
- `backups/db/2026/04/postgres-daily-20260407.sql.gz`

## Lifecycle & Retention

| Age | Tier | Cost Impact |
|-----|------|-------------|
| 0–30 days | Hot | Standard access pricing |
| 30–90 days | Cool | ~50% cheaper storage, slightly higher access cost |
| 90+ days | Archive | ~90% cheaper storage, rehydration required for access |

Soft-delete is enabled with a 7-day retention window for both blobs and containers.

## Authentication

- **No shared keys.** `shared_access_key_enabled = false` on the storage account.
- **Managed Identity** with `Storage Blob Data Contributor` RBAC role for pipeline agents.
- **OIDC** for Terraform provider auth (az CLI login, no secrets in CI).
- **SAS tokens** can be generated on-demand for time-limited external sharing.

## Deploying

```bash
cd infra/storage

# Authenticate via az CLI (OIDC)
az login

# Initialize and apply
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Create `terraform.tfvars` from `terraform.tfvars.example` and fill in your resource group name and any Managed Identity principal IDs.

## Estimated Cost

Under $5/month at current scale (Standard LRS, lifecycle auto-tiering).
