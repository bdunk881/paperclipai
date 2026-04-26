# Runbook: Production API Ingress Target

## Purpose

This runbook describes the intended production exposure path for `api.helloautoflow.com`.
Production backend traffic belongs on AKS. Staging backend traffic remains on Azure
Container Apps until the staging runtime is migrated separately.

## Source of Truth

- Cluster infra bootstrap: `.github/workflows/infra-deploy.yml`
- Production backend rollout: `.github/workflows/deploy-azure.yml`
- Production backend manifest: `k8s/production/backend.yaml`
- Production backend workload namespace: `autoflow-production`
- GitHub environment: `production`

## GitHub Environment Requirements

The `production` GitHub environment must define:

- variables
  - `AZURE_AKS_PRODUCTION_CLUSTER_NAME=autoflow-production-aks`
  - `AZURE_AKS_PRODUCTION_RESOURCE_GROUP=autoflow-production-rg`
  - `AZURE_PRODUCTION_API_HOST=api.helloautoflow.com`
  - `AZURE_PRODUCTION_LETSENCRYPT_EMAIL=ops@helloautoflow.com`
- secret
  - `AZURE_BACKEND_ENV_PRODUCTION` — newline-delimited env file consumed by
    `kubectl create secret generic autoflow-backend-secrets --from-env-file=...`

The production env secret must pin native auth to the direct CIAM authority.
The retired branded auth hostname is no longer a valid fallback:

```env
AZURE_CIAM_TENANT_SUBDOMAIN=<tenant-subdomain>
AZURE_CIAM_TENANT_ID=<tenant-guid>
AZURE_CIAM_AUTHORITY=https://<tenant-subdomain>.ciamlogin.com/<tenant-guid>
AUTH_NATIVE_AUTH_PROXY_BASE_URL=https://<tenant-subdomain>.ciamlogin.com/<tenant-guid>
```

The environment should also enforce at least one required reviewer before manual
production dispatches proceed.

## Expected Public Targets

The production backend service is defined as a public Azure Load Balancer service with:

- `service.beta.kubernetes.io/azure-dns-label-name: autoflow-production-api`
- `service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path: /health`

After the manifest is applied and the service is healthy, AKS should allocate:

- a public IPv4 address or hostname
- an Azure-managed hostname in the form `autoflow-production-api.<region>.cloudapp.azure.com`

Use `kubectl get svc backend -n autoflow-production` to capture both values.

The repo-managed TLS path is an `ingress-nginx` controller plus a dedicated ingress:

- controller service: `ingress-nginx-controller` in namespace `ingress-nginx`
- ClusterIssuer manifest: `k8s/production/cert-manager-clusterissuer.yaml`
- ingress manifest: `k8s/production/api-ingress.yaml`
- cert-manager-managed TLS secret: `autoflow-production-api-tls`

Use `kubectl get svc ingress-nginx-controller -n ingress-nginx` to capture the
HTTPS entrypoint that should serve `api.helloautoflow.com`.

## Preconditions Before DNS Cutover

1. `autoflow-production` namespace exists in the production cluster.
2. `backend` deployment is rolled out successfully.
3. `autoflow-backend-secrets` exists in the namespace with the required runtime env vars.
4. `/health` returns `200` through the public load balancer target.
5. TLS termination for `api.helloautoflow.com` is configured and verified.

Do not update `api.helloautoflow.com` DNS until all five conditions are true.

## Deployment Flow

The production deploy workflow now performs five API-specific steps after the
backend image is available in AKS:

1. Sync `autoflow-backend-secrets`
2. Install or update `cert-manager`
3. Render and apply `k8s/production/cert-manager-clusterissuer.yaml`
4. Install or update `ingress-nginx`
5. Apply `k8s/production/api-ingress.yaml`, wait for `autoflow-production-api-tls` to be issued, and verify HTTPS with `curl --resolve`

The deploy is not ready for DNS cutover until the HTTPS verification succeeds.
It also is not considered healthy until a native-auth initiate probe to
`/api/auth/native/oauth/v2.0/initiate` reaches the upstream over TLS and
returns an application response (`200` or `400`) instead of a proxy failure.

## Current Gap

As of 2026-04-25 with cert-manager automation prepared in-repo:

- the production AKS cluster exists
- the `autoflow-production` namespace and backend workload are deployed
- `/health` returns `200` through the raw backend load balancer target
- production AKS access from GitHub Actions is intentionally left open because
  GitHub-hosted runner CIDRs exceed AKS authorized IP range limits
- Let's Encrypt `HTTP-01` issuance for `api.helloautoflow.com` still requires the
  public DNS record for that hostname to resolve to the production ingress target

This means the repo can now install cert-manager, create the production
`ClusterIssuer`, and request the certificate automatically, but final issuance
cannot succeed until the DNS cutover sequence routes `api.helloautoflow.com` to
the production ingress endpoint that serves the ACME challenge.
