# Dev deploy runbook

How to get the latest `dev` branch running on the dev environment end-to-end. Captures the dependency cascade so a future operator (or new agent) doesn't relearn it from scratch.

> Scope: **dev only.** Staging + master cutover is its own runbook (TODO when we get there).

## What runs where

| Surface | Where | Pulls secrets from |
|---|---|---|
| Backend API | `autoflow-api-dev` Fly app | Infisical `dev` env via `infisical run` in `docker/api/entrypoint.sh` |
| Dashboard | `autoflow-dashboard` Cloudflare Pages (preview branch = `dev`) | Infisical → CF Pages env-var sync |
| Landing | `autoflow-landing` Cloudflare Pages (preview branch = `dev`) | Same |
| Docs | `autoflow-docs` Cloudflare Pages (preview branch = `dev`) | Same |
| Database | Supabase project `autoflow-dev` | DB-side; migrations applied separately |

## Pre-flight checks (one-time, then verify)

Before any dev deploy can succeed, these must be in place:

### 1. Infisical machine identity for GitHub Actions

Per [HEL-56](https://linear.app/helloautoflow/issue/HEL-56). The `Infisical/secrets-action@v1` step in every deploy workflow needs `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`.

**Verify:** GitHub Settings → Secrets and variables → Actions. Both should be present at the repo level.

**Smoke check:** `gh workflow run deploy-fly-api-dev.yml --ref dev` and watch the `Pull dev secrets from Infisical` step. If it fails with `Missing universal auth credentials`, the machine identity isn't set up.

### 2. Infisical token for Fly machines

Each Fly app needs `INFISICAL_TOKEN` set as a Fly secret so its Dockerfile entrypoint (`infisical run`) can authenticate at startup.

**Verify:** `fly secrets list -a autoflow-api-dev` shows `INFISICAL_TOKEN`.

**Set:** Create a service token in Infisical scoped read-only on the `dev` env, then:
```bash
fly secrets set INFISICAL_TOKEN=<token> -a autoflow-api-dev
```

### 3. Cloudflare Pages → Infisical sync

Per [HEL-37](https://linear.app/helloautoflow/issue/HEL-37). Each Pages project should have its environment variables synced from Infisical.

**Verify:** in Cloudflare Pages dashboard, each project's env-vars panel shows "Synced from Infisical" labels (not hand-set).

### 4. Branch protection

Per [HEL-7](https://linear.app/helloautoflow/issue/HEL-7). `dev` requires CI green on 7 status checks. PRs into `dev` won't merge without those passing (admin override available with `gh pr merge --admin`).

## Deploying changes to dev

### Backend (TS Express on Fly)

Triggered automatically on every push to `dev` that touches:
- `src/**`
- `docker/api/**`
- `fly.api.dev.toml`
- `infra/scripts/fly_api_smoke.sh`
- `.github/workflows/deploy-fly-api-dev.yml`
- `migrations/**`

**Manual trigger:**
```bash
gh workflow run deploy-fly-api-dev.yml --ref dev
```

**Watch:**
```bash
gh run watch
```

**What happens:**
1. Pulls secrets from Infisical via `Infisical/secrets-action@v1`.
2. Validates the required env vars are present (`FLY_API_TOKEN`, `DATABASE_URL`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_PUBLISHABLE_KEY`).
3. Sets up `flyctl`, ensures the Fly app exists, sets every runtime env var on the Fly machine via `flyctl secrets set`, runs `flyctl deploy --config fly.api.dev.toml`, and runs `infra/scripts/fly_api_smoke.sh` against `https://autoflow-api-dev.fly.dev` and `https://dev-api.helloautoflow.com`.

**On failure:**
- "Missing universal auth credentials" → fix HEL-56
- "Missing required Infisical secret X" → add `X` to Infisical `dev` env
- Fly deploy fails on container build → check `docker/api/Dockerfile` and `fly.api.dev.toml`
- Migration crash on boot → see `infra/runbooks/fly-api-dev.md` for log inspection

### Dashboard / Landing / Docs (Cloudflare Pages)

Auto-deploys on push to `dev`. Each project has its own workflow:
- `.github/workflows/dashboard-cloudflare-pages.yml`
- `.github/workflows/landing-cloudflare-pages.yml`
- `.github/workflows/docs-cloudflare-pages.yml`

**What happens:**
1. Pulls secrets from Infisical
2. `npm ci && npm run build` for the relevant package
3. `wrangler pages deploy` to the matching CF Pages project
4. The CF preview URL is reported in the PR / commit status

**On failure:**
- Build fails → check the workflow log; usually a missing env var (Infisical didn't sync that key) or a typescript error
- Deploy fails on auth → `CLOUDFLARE_API_TOKEN` not set in GitHub Actions secrets

### Database migrations (Supabase)

The Express backend applies migrations from `migrations/0NN_*.sql` automatically on startup (`src/db/sqlMigrations.ts`). New migrations land with their feature PRs and apply on the next deploy.

**Verify what's applied:** query `public.schema_migrations` on the dev Supabase project (`pjbpcfmidpxplcrwpcyk`) — every applied file is listed there.

## Smoke-testing the deploy

Once backend + dashboard are deployed:

```bash
# Backend health
curl https://dev-api.helloautoflow.com/api/health
# expected: 200 OK

# Backend smoke script (CORS preflight, /api/protected → 401, OAuth surfaces alive)
bash infra/scripts/fly_api_smoke.sh https://dev-api.helloautoflow.com

# Dashboard loads
curl -I https://dev.helloautoflow.com
# expected: 200 OK

# A protected route returns 401 without auth (proves auth is wired)
curl https://dev-api.helloautoflow.com/api/workspaces
# expected: 401 Unauthorized
```

For a deeper smoke, log in via the dev dashboard and verify the workspace + agent surfaces render.

## Rolling back

If a dev deploy breaks something:

```bash
# List recent Fly releases
flyctl releases -a autoflow-api-dev | head

# Roll back to a prior version
flyctl releases rollback <prior-version> -a autoflow-api-dev
```

For Cloudflare Pages, every deploy is a standalone build — point the `dev` alias at an earlier deploy via the CF Pages dashboard.

For migrations: forward-only by convention. If a migration broke dev, write a forward-fix migration; don't try to revert a destructive change after the fact.

## When this runbook is wrong

If you (a future agent or operator) find this describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change broke it. Drift is a P0.
