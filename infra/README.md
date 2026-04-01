# AutoFlow Infrastructure

Hetzner VPS + Coolify deployment with GitHub Actions CI/CD.

> **Migration note:** AWS ECS/Fargate + Terraform was replaced by Hetzner + Coolify.
> See [ALT-78](/ALT/issues/ALT-78) for the cost/infra research and [ALT-95](/ALT/issues/ALT-95) for the migration task.

## Stack

| Layer | Tool |
|---|---|
| VPS | Hetzner CX32 (~€7.49/mo) |
| PaaS | Coolify (self-hosted) |
| Container registry | GitHub Container Registry (ghcr.io) |
| TLS | Let's Encrypt via Coolify |
| Secrets | Coolify environment variables |
| CI/CD | GitHub Actions → Coolify webhook deploy |

## Services

Two Docker apps managed in Coolify:

| App | Source image | Port |
|---|---|---|
| `backend` | `ghcr.io/<org>/paperclipai-backend` | 8000 |
| `frontend` | `ghcr.io/<org>/paperclipai-frontend` | 80 |

## First-time server setup

1. Board provisions a Hetzner CX32 VPS (credit card, no contract).
2. SSH in and install Coolify:
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
3. Open Coolify UI (http://<hetzner-ip>:8000) and complete setup wizard.
4. Create two Coolify projects: `autoflow-staging` and `autoflow-production`.
5. Add each service as a **Docker Image** app pointing to the ghcr.io image.
6. Set environment variables per app (see **Secrets** below).
7. Enable **auto-deploy on new image** or rely on the GitHub Actions webhook trigger.

## GitHub Actions secrets required

Add these in the repo settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `COOLIFY_TOKEN` | Coolify API token (Settings → API Tokens) |
| `COOLIFY_URL` | Coolify instance URL, e.g. `https://coolify.autoflow.app` |
| `COOLIFY_STAGING_BACKEND_UUID` | UUID of the staging backend app in Coolify |
| `COOLIFY_STAGING_FRONTEND_UUID` | UUID of the staging frontend app in Coolify |
| `COOLIFY_PROD_BACKEND_UUID` | UUID of the production backend app in Coolify |
| `COOLIFY_PROD_FRONTEND_UUID` | UUID of the production frontend app in Coolify |

To find a UUID: open the app in Coolify → Settings → UUID.

## Secrets (environment variables)

Set these in each Coolify app's Environment Variables tab:

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SECRET_KEY=<random 64-char string>
ENV=staging   # or production
```

## Daily operations

- **Deploy to staging:** merge to `main` — GitHub Actions builds images, pushes to ghcr.io, triggers Coolify redeploy.
- **Promote to production:** approve the GitHub Actions production environment gate after staging smoke tests pass.
- **View logs:** Coolify UI → app → Logs, or SSH and `docker logs <container>`.
- **Scale:** Coolify UI → app → Resources → adjust CPU/memory limits.
- **Rollback:** Coolify UI → app → Deployments → redeploy a previous image tag.

## DNS

Point your domain to the Hetzner VPS IP via Cloudflare (proxy enabled for DDoS protection):

```
staging.autoflow.app  → A  <hetzner-ip>
autoflow.app          → A  <hetzner-ip>
```

## Monitoring

See `infra/monitoring/` for uptime and alerting configuration.
