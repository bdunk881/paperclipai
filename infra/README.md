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
├── monitoring.tf         # Application Insights, alert rules, workbook
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

## Database migrations

Alembic migrations run automatically before every deployment via a Container App
Job (`caj-autoflow-{environment}-migration`). The job uses the same backend image
and managed identity as the application — no credentials are stored anywhere.

### How it works

1. `deploy.yml` updates the migration job with the new image tag.
2. A job execution is started; the deploy workflow waits up to 5 minutes.
3. If the execution succeeds, the Container App revision is updated and traffic
   is cut over. If it fails, the deploy is aborted — no new revision is created.

### First deploy (empty database)

On the very first deployment the database will be empty. `alembic upgrade head`
is idempotent — it creates the `alembic_version` tracking table and applies all
migrations in order. No manual steps are required.

### Generating a new migration

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/autoflow"
alembic revision --autogenerate -m "describe your change"
# Review the generated file in alembic/versions/ before committing
```

### Applying migrations locally

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/autoflow?sslmode=disable"
alembic upgrade head
```

### Rolling back a migration

```bash
# Revert one step
alembic downgrade -1

# Revert to a specific revision
alembic downgrade <revision-id>

# Show revision history
alembic history --verbose
```

To roll back in a live environment after a bad deploy, connect to the container:

```bash
az containerapp exec \
  --name ca-autoflow-production-backend \
  --resource-group rg-autoflow-production \
  --command "alembic downgrade -1"
```

Then redeploy the previous image tag via `workflow_dispatch`.

## Observability

AutoFlow uses **workspace-based Application Insights** linked to the Log Analytics
workspace provisioned in `main.tf`. All backend telemetry — request traces,
exceptions, and custom events — lands in one queryable store.

### Resources (provisioned by `monitoring.tf`)

| Resource | Name pattern | Purpose |
|---|---|---|
| Application Insights | `appi-autoflow-{env}` | Telemetry sink |
| Monitor Action Group | `ag-autoflow-{env}-alerts` | Alert recipients |
| Scheduled Query Alert | `alert-…-5xx-error-rate` | 5xx error rate > 1 % / 5 min |
| Scheduled Query Alert | `alert-…-p99-latency` | P99 latency > 3 000 ms / 5 min |
| Scheduled Query Alert | `alert-…-container-restarts` | Container restarts > 2 / 10 min |
| App Insights Workbook | `AutoFlow {Env} Overview` | Request volume, errors, latency |

### Viewing the dashboard

1. Open the Azure Portal → Resource Group `rg-autoflow-{env}`.
2. Select the Application Insights resource `appi-autoflow-{env}`.
3. Navigate to **Workbooks** → **AutoFlow {Env} Overview**.

The workbook shows: request volume, 5xx error rate, latency percentiles (p50 / p95 / p99),
and unhandled exceptions — all over the last hour with 5-minute granularity.

### Adding alert recipients

Edit the action group `ag-autoflow-{env}-alerts` in the Azure Portal (or via
Terraform `azurerm_monitor_action_group.main`) to add email addresses, webhook
endpoints, or PagerDuty/Opsgenie integrations.

### Backend instrumentation

The Python SDK is initialized in `backend/observability.py`.  Call
`configure_telemetry(app)` once in `main.py` at startup:

```python
from observability import configure_telemetry
app = FastAPI(...)
configure_telemetry(app)
```

The `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable is injected
automatically by the Container App from Key Vault.  In local development,
unset this variable to disable telemetry (the function is a no-op when it is absent).

Custom spans for key operations (workflow execution, LLM calls):

```python
from opentelemetry import trace
tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("workflow.execute") as span:
    span.set_attribute("workflow.id", workflow_id)
    span.set_attribute("llm.model", model_name)
    result = await run_workflow(...)
```

### Frontend instrumentation

The dashboard SPA (Vite/React) uses `@microsoft/applicationinsights-web` and is
bootstrapped in `dashboard/src/telemetry.ts`, called from `dashboard/src/main.tsx`.

**Auto-captured:** page views (SPA route changes), unhandled JS exceptions, and
outbound fetch/XHR dependency calls with backend trace correlation.

The connection string is passed at Vite build time as:

```
VITE_APPLICATIONINSIGHTS_CONNECTION_STRING=<connection_string>
```

Set this in the **Vercel project environment variables** (Production + Preview
environments) — use the same `connection_string` output from Terraform:

```bash
terraform -chdir=infra/terraform output -raw app_insights_connection_string
```

In local development the variable is absent and telemetry is a no-op.

Custom events from application code:

```typescript
import { trackEvent, trackException } from "./telemetry";

trackEvent("workflow.created", { workflowId: id, templateId });
trackException(error, { page: "WorkflowBuilder" });
```

## DNS

Configure a CNAME from your domain to the Container App FQDN
(`terraform output container_app_fqdn`). Azure Container Apps handles TLS automatically.
