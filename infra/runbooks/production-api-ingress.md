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

The environment should also enforce at least one required reviewer before manual
production dispatches proceed.

## Expected Public Target

The production backend service is defined as a public Azure Load Balancer service with:

- `service.beta.kubernetes.io/azure-dns-label-name: autoflow-production-api`
- `service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path: /health`

After the manifest is applied and the service is healthy, AKS should allocate:

- a public IPv4 address or hostname
- an Azure-managed hostname in the form `autoflow-production-api.<region>.cloudapp.azure.com`

Use `kubectl get svc backend -n autoflow-production` to capture both values.

## Preconditions Before DNS Cutover

1. `autoflow-production` namespace exists in the production cluster.
2. `backend` deployment is rolled out successfully.
3. `autoflow-backend-secrets` exists in the namespace with the required runtime env vars.
4. `/health` returns `200` through the public load balancer target.
5. TLS termination for `api.helloautoflow.com` is configured and verified.

Do not update `api.helloautoflow.com` DNS until all five conditions are true.

## Current Gap

As of 2026-04-24 / 2026-04-25 verification:

- the production AKS cluster exists
- no `autoflow-production` namespace or backend workload is deployed yet
- no in-cluster `autoflow-backend-secrets` secret exists yet
- no repo-managed TLS termination path exists yet for `api.helloautoflow.com`

This means the Azure load balancer target can be prepared in Kubernetes, but DNS cutover
must stay blocked until workload secrets and TLS are resolved.
