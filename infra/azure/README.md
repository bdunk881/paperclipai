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
terraform init -backend-config=backend-config/staging.hcl
terraform apply -var="environment=staging" -var="alert_email=ops@helloautoflow.com"
```

### Production

```bash
terraform init -backend-config=backend-config/production.hcl
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
| `staging` | `AZURE_STAGING_KEY_VAULT_NAME` | Optional explicit staging Key Vault name; use when auto-discovery from the app resource group is not sufficient |
| `staging` | `AZURE_STAGING_KEY_VAULT_RESOURCE_GROUP` | Optional resource group override paired with `AZURE_STAGING_KEY_VAULT_NAME` |
| `staging` | `AZURE_STAGING_KEY_VAULT_URI` | Optional explicit staging Key Vault URI; the deploy workflow writes this to `AZURE_KEY_VAULT_URI` on every staging deploy |
| `staging` | `AZURE_BACKEND_ENV_STAGING_SOCIAL_AUTH_CLIENTID` | Optional non-secret staging Google OAuth client ID; the deploy workflow injects it if the multiline secret does not include `GOOGLE_CLIENT_ID` |
| `staging` | `AZURE_STAGING_KEY_VAULT_URI` | Optional staging Key Vault URI override; defaults to `https://autoflow-staging-hub-kv.vault.azure.net/` when unset |
| `production` | `AZURE_AKS_PRODUCTION_CLUSTER_NAME` | Production AKS cluster name |
| `production` | `AZURE_AKS_PRODUCTION_RESOURCE_GROUP` | Resource group containing the production AKS cluster |
| `production` | `AZURE_PRODUCTION_API_HOST` | Public production API hostname used for DNS and cutover tracking |
| `production` | `AZURE_PRODUCTION_LETSENCRYPT_EMAIL` | ACME account email used by the production cert-manager `ClusterIssuer` |

**Required GitHub environment secrets:**

| Environment | Secret | Description |
|---|---|---|
| `staging` | `AZURE_BACKEND_ENV_STAGING` | Optional newline-delimited general backend env file for the staging Container App; use it for shared runtime env such as `AZURE_KEY_VAULT_URI`, connector callback URLs, and other non-social-auth settings |
| `staging` | `AZURE_BACKEND_ENV_STAGING_SOCIAL_AUTH` | Newline-delimited env file containing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_JWT_SECRET`, and `SOCIAL_AUTH_CALLBACK_BASE_URL` for the staging Container App |
| `staging` | `AZURE_BACKEND_ENV_STAGING_RUNTIME` | Optional newline-delimited env file for direct staging runtime overrides such as `DATABASE_URL`, `REDIS_URL`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, or other Key Vault-backed values during recovery |
| `production` | `AZURE_BACKEND_ENV_PRODUCTION` | Newline-delimited env file materialized into the `autoflow-backend-secrets` Kubernetes secret |

**Required Terraform variables for CIAM app-registration management:**

| Variable | Description |
|---|---|
| `TF_VAR_ciam_graph_client_id` | Client ID for the CIAM-tenant Graph application used by the aliased `azuread.ciam` provider |
| `TF_VAR_ciam_graph_client_secret` | Client secret for the same CIAM-tenant Graph application |

**Setup steps:**

1. Run `terraform apply` to create all Azure resources (see Usage above).
2. Add the repository-level OIDC variables listed above.
3. Create two GitHub Environments in Settings → Environments:
   - `staging` — no approvals
   - `production` — add required reviewers for the production deployment gate
4. Add the environment-scoped backend target variables for each environment.
5. Add `AZURE_BACKEND_ENV_STAGING` to the `staging` environment when the backend needs shared runtime settings beyond social auth. At minimum, connector OAuth flows that load secrets from Key Vault need:

   ```env
   AZURE_KEY_VAULT_URI=https://autoflow-staging-hub-kv.vault.azure.net/
   ```

   You may also place other staging-only backend env values here. The deploy workflow merges this file with the social-auth env file on every staging rollout.

6. Add `AZURE_BACKEND_ENV_STAGING_SOCIAL_AUTH` to the `staging` environment with:

   ```env
   GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
   APP_JWT_SECRET=<32+ char random secret>
   SOCIAL_AUTH_CALLBACK_BASE_URL=https://staging-api.helloautoflow.com/api/auth/social
   SOCIAL_AUTH_DASHBOARD_URL=https://staging.app.helloautoflow.com
   AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS=https://staging.app.helloautoflow.com
   ```

   Set `GOOGLE_CLIENT_ID` either inside the multiline secret above or as the
   Actions variable `AZURE_BACKEND_ENV_STAGING_SOCIAL_AUTH_CLIENTID`. The
   workflow also accepts `GOOGLE_CLIENT_ID` as a compatibility fallback if you
   later rename the variable to match the runtime env key directly.

   The staging deploy workflow validates those keys, requires the dashboard URL
   to match the staging host, and requires either
   `AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS` or `ALLOWED_ORIGINS` to include
   `https://staging.app.helloautoflow.com`. It injects the resulting values into
   the Container App on every deploy alongside the QA bypass flags.
   For the Google OAuth client configuration in the Google Cloud console, use:

   - Authorized JavaScript origins: `https://staging.app.helloautoflow.com`
   - Authorized redirect URIs: `https://staging-api.helloautoflow.com/api/auth/social/google/callback`

   If `AZURE_STAGING_API_HOST` changes, the redirect URI must change with it to
   keep the Passport callback route aligned with the deployed backend host.
6. Set either `AZURE_STAGING_KEY_VAULT_URI` directly or `AZURE_STAGING_KEY_VAULT_NAME` and `AZURE_STAGING_KEY_VAULT_RESOURCE_GROUP` so every staging deploy rewrites `AZURE_KEY_VAULT_URI` on the Container App to the live vault. If these overrides are unset, the workflow auto-discovers a single staging Key Vault in the Container App resource group.
7. When Key Vault access is degraded, populate `AZURE_BACKEND_ENV_STAGING_RUNTIME` with the minimum direct runtime values needed to boot the backend, then re-run the staging deploy workflow. Typical emergency keys are `DATABASE_URL`, `REDIS_URL`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, `AZURE_CIAM_CLIENT_SECRET`, and Stripe secrets.
8. Use [`infra/runbooks/staging-key-vault-container-apps.md`](../runbooks/staging-key-vault-container-apps.md) for the operational recovery procedure.
9. Add `AZURE_BACKEND_ENV_PRODUCTION` to the `production` environment so the
   AKS rollout can create `autoflow-backend-secrets` before the deployment starts.
10. Verify production-specific values do not reference `staging` or `nonprod`
   resource names; the workflow now hard-fails on cross-environment targets.
11. Ensure `AZURE_BACKEND_ENV_PRODUCTION` includes CIAM auth fallback inputs
   (`AZURE_CIAM_TENANT_ID`/`AZURE_TENANT_ID`, `AZURE_CIAM_TENANT_SUBDOMAIN`/`AZURE_TENANT_SUBDOMAIN`,
   and a CIAM audience/client setting) plus `ALLOWED_ORIGINS` containing
   `https://app.helloautoflow.com`.
12. Set both `AZURE_CIAM_AUTHORITY` and `AUTH_NATIVE_AUTH_PROXY_BASE_URL` in
   `AZURE_BACKEND_ENV_PRODUCTION` to the direct tenant authority:

   `https://<tenant-subdomain>.ciamlogin.com/<tenant-guid>`

   Example:

   `https://<tenant-subdomain>.ciamlogin.com/<tenant-guid>`

   The production deploy workflow now rejects any non-`ciamlogin.com` runtime
   value so the backend cannot drift back to the retired branded auth host.

**Validation checks**

- `gh api repos/<owner>/<repo>/environments` should show a `production`
  protection rule with required reviewers before production deploys are allowed.
- `gh api repos/<owner>/<repo>/environments/production/variables` should include
  the three production AKS variables listed above.
- `gh run list --workflow deploy-azure.yml` should show a successful
  production backend run that imports into ACR, creates the K8s secret, rolls
  out the AKS deployment, and passes the native-auth initiate smoke check
  before you cut traffic to the new backend.

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
  enable-ciam-native-auth-sspr.sh — enable Email OTP SSPR for native auth in the external tenant
  provision-ciam.sh            — create the CIAM SPA app registration and output env vars
  configure-ciam-microsoft-account-oidc.sh — create/update the Microsoft Account OIDC provider and attach it to a CIAM user flow
  sync-ciam-redirect-uris.sh   — upsert the dashboard auth callback/logout URIs on the CIAM SPA app
  validate-ciam-prereqs.sh     — validate subscription + Graph access before provisioning
  verify-ciam-native-auth-sspr.sh — verify resetpassword/v1.0/start returns a continuation token
```

The dashboard is in a transition period between root-based MSAL redirects and
`${window.location.origin}/auth/callback`. Until that migration is fully merged
and verified, keep both the host root and `/auth/callback` registered as SPA
redirect URIs for production, staging, the active Vercel preview hosts, and
localhost. Run `./scripts/sync-ciam-redirect-uris.sh` after any custom-domain
cutover, preview-host policy change, or auth route change.

Native auth password reset depends on Email OTP SSPR being enabled in the
external tenant. After `provision-ciam.sh` creates the app registration, run
`./scripts/enable-ciam-native-auth-sspr.sh` and then
`./scripts/verify-ciam-native-auth-sspr.sh` with a real customer username.
Without that tenant-side policy, Azure returns `AADSTS500222` from
`resetpassword/v1.0/start` even when the app code and proxy routing are correct.

Microsoft Account federation is split intentionally:

- Terraform manages the `autoflow-msa-federation` application registration and
  secret inside the CIAM tenant.
- `./scripts/configure-ciam-microsoft-account-oidc.sh` manages the tenant-side
  custom OIDC identity provider plus the user-flow attachment, using Graph.

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

## Terraform state migration

The Azure backend now uses an explicit dedicated state key for staging while
production continues to use the legacy shared key plus the `production`
workspace until its state migration is completed:

- `backend-config/staging.hcl` → `autoflow-staging.tfstate`
- `backend-config/production.hcl` → `autoflow.tfstate` with `terraform workspace select production`

To migrate an existing workspace-backed state into a dedicated backend key:

1. Select the source workspace and pull a backup copy:
   `terraform workspace select <env>`
   `terraform state pull > <env>-workspace.tfstate`
2. Return to the default workspace before reconfiguring the backend:
   `terraform workspace select default`
3. Reinitialize against the target backend key:
   `terraform init -reconfigure -backend-config=backend-config/<env>.hcl`
4. Push the copied state into the dedicated backend:
   `terraform state push <env>-workspace.tfstate`
5. Run `terraform plan -var="environment=<env>"` and remove any resources that belong only to the other environment with `terraform state rm` before the next apply.
