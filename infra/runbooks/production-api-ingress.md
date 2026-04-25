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
- secret
  - `AZURE_BACKEND_ENV_PRODUCTION` — newline-delimited env file consumed by
    `kubectl create secret generic autoflow-backend-secrets --from-env-file=...`
  - `AZURE_PRODUCTION_API_TLS_CERT_PEM` — PEM-encoded certificate chain for
    `api.helloautoflow.com`
  - `AZURE_PRODUCTION_API_TLS_KEY_PEM` — PEM-encoded private key for
    `api.helloautoflow.com`

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
- ingress manifest: `k8s/production/api-ingress.yaml`
- TLS secret: `autoflow-production-api-tls`

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

The production deploy workflow now performs four API-specific steps after the
backend image is available in AKS:

1. Sync `autoflow-backend-secrets`
2. Sync `autoflow-production-api-tls`
3. Install or update `ingress-nginx`
4. Apply `k8s/production/api-ingress.yaml` and verify HTTPS with `curl --resolve`

The deploy is not ready for DNS cutover until the HTTPS verification succeeds.

## Current Gap

As of 2026-04-25 pre-change verification:

- the production AKS cluster exists
- the `autoflow-production` namespace and backend workload are deployed
- `/health` returns `200` through the raw backend load balancer target
- no ingress controller or ingress resource is serving `api.helloautoflow.com` yet
- the production GitHub environment is missing the TLS certificate/key secrets
  required to create `autoflow-production-api-tls`
- GitHub-hosted runners cannot be safely allowlisted for AKS API access because
  GitHub's official meta endpoint currently publishes thousands of Actions CIDRs,
  while AKS authorized IP ranges support only up to 200 entries

This means the Azure load balancer target can be prepared in Kubernetes, and the
repo now defines the TLS termination path, but deploy/dns cutover must stay blocked
until the production TLS material is available to the workflow.
