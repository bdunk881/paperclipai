# Fly.io FastAPI dev and staging service

Use this runbook for the standalone FastAPI Fly.io services used by the
`dev` and `staging` branches.

## Purpose

- Deploy the Python FastAPI dev app backed by the isolated `autoflow-dev`
  Supabase project.
- Deploy the Python FastAPI staging app backed by production Supabase API
  credentials.
- Verify the live service with health, knowledge, native auth, callback, and webhook smoke checks.
- Keep both rollout paths reproducible through GitHub Actions instead of ad hoc console changes.

## GitHub Actions configuration

Configure these values before running the workflow:

| Type | Name | Required | Notes |
|---|---|---|---|
| Secret | `FLY_API_TOKEN` | Yes | Prefer a deploy token that can manage both Fly apps. |
| Secret | `DEV_DATABASE_URL` | Dev only | PostgreSQL connection string for `autoflow-dev`. |
| Secret | `DEV_SUPABASE_URL` | Dev only | Supabase URL for `autoflow-dev`. |
| Secret | `DEV_SUPABASE_ANON_KEY` | Dev only | Public anon key for `autoflow-dev`. |
| Secret | `DEV_SUPABASE_SERVICE_ROLE_KEY` | Dev only | Service-role key for `autoflow-dev`. |
| Secret | `PRODUCTION_SUPABASE_URL` | Staging only | Shared Supabase URL used by staging and master. |
| Secret | `PRODUCTION_SUPABASE_ANON_KEY` | Staging only | Shared anon key used by staging and master. |
| Secret | `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` | Staging only | Shared service-role key used by staging and master. |
| Variable | `FLY_DEV_APP_NAME` | Optional | Defaults to `autoflow-fastapi-dev`. |
| Variable | `FLY_DEV_BASE_URL` | Optional | Defaults to `https://autoflow-fastapi-dev.fly.dev`. |
| Variable | `FLY_STAGING_APP_NAME` | Optional | Defaults to `autoflow-fastapi-staging`. |
| Variable | `FLY_STAGING_BASE_URL` | Optional | Defaults to `https://autoflow-fastapi-staging.fly.dev`. |
| Variable | `FLY_STAGING_SMOKE_USER_ID` | Optional | Defaults to `qa-smoke-user`. |
Fly.io recommends deploy tokens rather than broad auth tokens for CI/CD.

## Deploy

Automatic dev deploys run from `.github/workflows/deploy-fly-fastapi-dev.yml`
when `dev` receives changes to:

- `backend/**`
- `docker/backend/Dockerfile`
- `fly.dev.toml`
- `infra/scripts/fly_fastapi_smoke.sh`

Automatic staging deploys run from `.github/workflows/deploy-fly-fastapi-staging.yml`
when `staging` receives changes to:

- `backend/**`
- `docker/backend/Dockerfile`
- `fly.toml`
- `infra/scripts/fly_fastapi_smoke.sh`

Manual dev deploy:

1. Open the `Deploy FastAPI Fly.io Dev` workflow in GitHub Actions.
2. Run `workflow_dispatch`.
3. Confirm the validation job passes before the deploy job starts.

Manual staging deploy:

1. Open the `Deploy FastAPI Fly.io Staging` workflow in GitHub Actions.
2. Run `workflow_dispatch`.
3. Confirm the validation job passes before the deploy job starts.

## Smoke verification

The workflow runs `infra/scripts/fly_fastapi_smoke.sh` against the live host after `flyctl deploy`.

The smoke script verifies:

- `GET /health`
- `POST /api/knowledge/bases`
- `GET /api/knowledge/bases`
- `PATCH /api/knowledge/bases/{id}`
- `POST /api/knowledge/bases/{id}/documents`
- `POST /api/knowledge/search`
- `POST /api/auth/native/oauth2/v2.0/initiate`
- `GET /api/integrations/slack/oauth/callback?error=...`
- `POST /api/webhooks/stripe`

Artifacts are uploaded to `fastapi-fly-<environment>-evidence-<run_id>` and include:

- `summary.md`
- `dns-ready-cutover.md`
- `dns-current.md`
- `fly-status.txt`
- `fly-ips.txt`
- response bodies for each smoke step
- `requests.tsv`

## Local verification

From the repo root:

```bash
python3 -m venv .venv-fastapi
source .venv-fastapi/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd backend
uvicorn main:app --host 127.0.0.1 --port 8081
```

In another shell:

```bash
FASTAPI_SMOKE_BASE_URL=http://127.0.0.1:8081 \
FASTAPI_SMOKE_USER_ID=qa-smoke-user \
bash infra/scripts/fly_fastapi_smoke.sh
```

## Rollback

If the latest deploy is unhealthy:

1. Open the Fly app dashboard for `autoflow-fastapi-staging`.
2. Identify the last healthy release.
3. Redeploy that release with `flyctl deploy --image <image-ref> --app autoflow-fastapi-staging` from a trusted operator machine.
4. Re-run `infra/scripts/fly_fastapi_smoke.sh` against the restored host.
5. Capture the Fly release id and smoke artifact link in the issue comment before closing the incident.
