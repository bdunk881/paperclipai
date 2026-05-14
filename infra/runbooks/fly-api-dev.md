# Fly TS Express API (dev) runbook

How to operate the `autoflow-api-dev` Fly app — the consolidated TS Express
backend deployed for the dev environment. Companion to `infra/runbooks/dev-deploy.md`.

## What runs here

`src/app.ts` packaged via `docker/api/Dockerfile`. Public hostname
`dev-api.helloautoflow.com` (Cloudflare CNAME → `autoflow-api-dev.fly.dev`).
Behind this hostname is every `/api/*` route the dashboard expects: missions,
agents, runs, billing, integrations, llm-configs, observability, control plane,
landing public endpoints, etc.

Runs in parallel with `autoflow-fastapi-dev` (the legacy relay shim from the
aborted Phase-3 cutover — see `backend/fly-cutover-probe-matrix.md`) until
HEL-97 retires the FastAPI app entirely.

## First-time setup

These must be in place before the deploy workflow can succeed.

### 1. Infisical secrets

The `autoflow-api-dev` Fly machine pulls secrets at startup via the entrypoint
script (`docker/api/entrypoint.sh`). Required Fly-level secrets:

- `INFISICAL_PROJECT_ID` — auto-flow-va-pt project ID
- `INFISICAL_TOKEN` — a service token scoped read-only on the `dev` env

Both are set by the deploy workflow via `flyctl secrets set --stage` so a
machine restart reads the current value. To rotate the token:

```bash
flyctl secrets set INFISICAL_TOKEN=<new-token> -a autoflow-api-dev
```

### 2. Custom domain + TLS

```bash
# DNS: Cloudflare → dev-api.helloautoflow.com CNAME → autoflow-api-dev.fly.dev
# (proxied=false so Fly can issue Let's Encrypt cert)

flyctl certs add dev-api.helloautoflow.com -a autoflow-api-dev
flyctl certs check dev-api.helloautoflow.com -a autoflow-api-dev   # confirm "Configured"
```

### 3. GitHub Actions secrets

Required at the repo level (alongside the Cloudflare + Fly secrets already used
by the FastAPI workflow):

- `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` — universal-auth machine ID
- `FLY_API_TOKEN` — Fly deploy token, accessible via Infisical's dev env

## Deploying

### Auto (every push to dev)

Triggers on push to `dev` touching `src/**`, `docker/api/**`, `fly.api.dev.toml`,
the deploy workflow, the smoke script, or `migrations/**`.

```bash
# Watch the most recent deploy:
gh workflow run deploy-fly-api-dev.yml --ref dev
gh run watch
```

### Manual

```bash
flyctl deploy --config fly.api.dev.toml --remote-only -a autoflow-api-dev
```

## Smoke checks

The deploy workflow runs `infra/scripts/fly_api_smoke.sh` automatically.
Run by hand:

```bash
bash infra/scripts/fly_api_smoke.sh https://autoflow-api-dev.fly.dev
# Or against the custom domain:
bash infra/scripts/fly_api_smoke.sh https://dev-api.helloautoflow.com
```

The smoke verifies:
- `/health` returns 200 with `status: ok`
- CORS preflight from `dev.helloautoflow.com` is allowed
- `/api/protected` returns 401 (auth wired correctly)
- OAuth callback + Stripe webhook surfaces return real handler responses
  (no `Public edge relay is not configured` placeholders from the FastAPI shim)

## Inspecting + debugging

```bash
flyctl status -a autoflow-api-dev
flyctl logs -a autoflow-api-dev
flyctl ssh console -a autoflow-api-dev   # interactive shell into the runtime container
flyctl machine list -a autoflow-api-dev
```

## Rolling back

```bash
# List previous releases
flyctl releases -a autoflow-api-dev

# Roll back to a specific version
flyctl deploy --image registry.fly.io/autoflow-api-dev:<previous-tag> --strategy immediate -a autoflow-api-dev
```

The DNS doesn't change during a rollback — only the underlying Fly app image
changes. Custom domain + Cloudflare CNAME stay valid.

## Relationship to autoflow-fastapi-dev

| Question | Answer |
|---|---|
| Are both apps running? | Yes, in parallel until HEL-97 cleanup. |
| Which one does the dashboard hit? | After HEL-84 lands the dashboard's host-map points dev → `dev-api.helloautoflow.com` (this app). Before that, dashboards point at `autoflow-fastapi-dev`. |
| Which one handles Stripe webhooks? | Stripe is configured with the legacy hostname for now. Production webhook URL doesn't change during cutover — only the Fly app behind it (HEL-96). |
| When does the FastAPI app go away? | After HEL-96 (production cutover) is stable for 7+ days. HEL-97 destroys all three FastAPI Fly apps + removes the related code. |

## See also

- `fly.api.dev.toml` — Fly app config
- `docker/api/Dockerfile` — image build
- `docker/api/entrypoint.sh` — Infisical wrapper
- `.github/workflows/deploy-fly-api-dev.yml` — deploy workflow
- `infra/scripts/fly_api_smoke.sh` — smoke test
- `infra/runbooks/dev-deploy.md` — broader dev environment overview
- HEL-83 (this work) → HEL-95 (staging clone) → HEL-96 (production clone)
