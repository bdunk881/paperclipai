# Legacy Kubernetes manifests (retired)

AutoFlow no longer deploys to Azure Container Registry or AKS. Production and staging
API compute run on [Fly.io](https://fly.io); the dashboard and landing apps run on
Cloudflare Pages.

The YAML manifests that previously lived under `k8s/staging/` and `k8s/production/`
were removed as part of HEL-163 (Azure sundown). Do not reintroduce `azurecr.io`
image references — CI fails if they appear anywhere in the repository.

Current deploy targets are documented in [`AGENTS.md`](../AGENTS.md) under **Environments**.
