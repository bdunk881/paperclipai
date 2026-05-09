# Dev deploy runbook

How to get the latest `dev` branch running on the dev environment end-to-end. Captures the dependency cascade so a future operator (or new agent) doesn't relearn it from scratch.

> Scope: **dev only.** Staging + master cutover is its own runbook (TODO when we get there).

## What runs where

| Surface | Where | Pulls secrets from |
|---|---|---|
| Backend API | `autoflow-fastapi-dev` Fly app | Infisical `dev` env via `infisical run` in Dockerfile entrypoint |
| Dashboard | `autoflow-dashboard` Cloudflare Pages (preview branch = `dev`) | Infisical → CF Pages env-var sync |
| Landing | `autoflow-landing` Cloudflare Pages (preview branch = `dev`) | Same |
| Docs | `autoflow-docs` Cloudflare Pages (preview branch = `dev`) | Same |
| Database | Supabase project `autoflow-dev` | DB-side; migrations applied separately |

## Pre-flight checks (one-time, then verify)

Before any dev deploy can succeed, these must be in place:

### 1. Infisical machine identity for GitHub Actions

Per [HEL-56](https://linear.app/helloautoflow/issue/HEL-56). The `Infisical/secrets-action@v1` step in every deploy workflow needs `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`.

**Verify:** GitHub Settings → Secrets and variables → Actions. Both should be present at the repo level.

**Smoke check:** `gh workflow run deploy-fly-fastapi-dev.yml --ref dev` and watch the `Pull dev secrets from Infisical` step. If it fails with `Missing universal auth credentials`, the machine identity isn't set up.

### 2. Infisical token for Fly machines

Each Fly app needs `INFISICAL_TOKEN` set as a Fly secret so its Dockerfile entrypoint (`infisical run`) can authenticate at startup.

**Verify:** `fly secrets list -a autoflow-fastapi-dev` shows `INFISICAL_TOKEN`.

**Set:** Create a service token in Infisical scoped read-only on the `dev` env, then:
```bash
fly secrets set INFISICAL_TOKEN=<token> -a autoflow-fastapi-dev
```

### 3. Cloudflare Pages → Infisical sync

Per [HEL-37](https://linear.app/helloautoflow/issue/HEL-37). Each Pages project should have its environment variables synced from Infisical.

**Verify:** in Cloudflare Pages dashboard, each project's env-vars panel shows "Synced from Infisical" labels (not hand-set).

### 4. Branch protection

Per [HEL-7](https://linear.app/helloautoflow/issue/HEL-7). `dev` requires CI green on 7 status checks. PRs into `dev` won't merge without those passing (admin override available with `gh pr merge --admin`).

## Deploying changes to dev

### Backend (FastAPI on Fly)

Triggered automatically on every push to `dev` that touches:
- `backend/**`
- `docker/backend/Dockerfile`
- `fly.dev.toml`
- `infra/scripts/fly_fastapi_smoke.sh`
- `.github/workflows/deploy-fly-fastapi-dev.yml`

**Manual trigger:**
```bash
gh workflow run deploy-fly-fastapi-dev.yml --ref dev
```

**Watch:**
```bash
gh run watch
```

**What happens:**
1. `validate-backend` — pytest runs against `backend/tests/test_knowledge_api.py`
2. `deploy` job — pulls secrets from Infisical via the action, validates the required env vars are present, sets up `flyctl`, ensures the Fly app exists, sets `INFISICAL_PROJECT_ID` + `INFISICAL_TOKEN` on the Fly machine, runs `flyctl deploy --config fly.dev.toml`, and runs smoke checks against `https://autoflow-fastapi-dev.fly.dev`.
3. Drains legacy per-secret values from Fly (`APP_ENV`, `DATABASE_URL`, etc.) since those now flow from Infisical at runtime.

**On failure:**
- "Missing universal auth credentials" → fix HEL-56
- "Missing required Infisical secret X" → add `X` to Infisical `dev` env
- Fly deploy fails on container build → check `docker/backend/Dockerfile` and the `fly.dev.toml`

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

**Not auto-applied.** This is intentional — schema changes need supervised application.

When a migration PR lands on `dev`, manually apply it to the dev Supabase project:

```bash
# Via Supabase CLI (preferred for the supabase/ migrations)
supabase link --project-ref <autoflow-dev-project-ref>
supabase db push

# Or manually via psql for the legacy migrations/ directory
psql $DEV_DATABASE_URL -f migrations/0NN_<name>.sql
```

**Verify:** check the `_migrations` or `schema_migrations` table on dev Supabase to see what's applied.

**Future automation:** worth filing a follow-up to wire migration application into the deploy workflow so it's harder to forget.

## Smoke-testing the deploy

Once backend + dashboard are deployed:

```bash
# Backend health
curl https://autoflow-fastapi-dev.fly.dev/health
# expected: {"status": "ok", ...}

# Dashboard loads
curl -I https://dev.app.helloautoflow.com    # or whatever the dev preview URL is
# expected: 200 OK

# A protected route returns 401 without auth (proves the chain is wired)
curl https://autoflow-fastapi-dev.fly.dev/api/workspaces
# expected: 401 Unauthorized
```

For a deeper smoke, log in via the dev dashboard and verify the workspace + agent surfaces render.

## Rolling back

If a dev deploy breaks something:

```bash
# List recent Fly releases
flyctl releases -a autoflow-fastapi-dev | head

# Roll back
flyctl deploy --image registry.fly.io/autoflow-fastapi-dev:v<previous> -a autoflow-fastapi-dev
```

For Cloudflare Pages, every deploy is a standalone build — point the `dev` alias at an earlier deploy via the CF Pages dashboard.

For migrations: forward-only by convention. If a migration broke dev, write a forward-fix migration; don't try to revert a destructive change after the fact.

## When this runbook is wrong

If you (a future agent or operator) find this describes a flow that no longer matches reality, **fix the file in the same PR** as whatever change broke it. Drift is a P0.
