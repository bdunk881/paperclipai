# Fly.io FastAPI staging service

Use this runbook for the standalone FastAPI staging service deployed to Fly.io for [ALT-2335](/ALT/issues/ALT-2335).

## Purpose

- Deploy the Python FastAPI knowledge-service staging app on Fly.io.
- Verify the live service with CRUD, ingest, and search smoke checks.
- Keep the staging rollout reproducible through GitHub Actions instead of ad hoc console changes.

## GitHub Actions configuration

Configure these values before running the workflow:

| Type | Name | Required | Notes |
|---|---|---|---|
| Secret | `FLY_API_TOKEN` | Yes | Prefer an app-scoped deploy token for `autoflow-fastapi-staging`. |
| Variable | `FLY_STAGING_APP_NAME` | Optional | Defaults to `autoflow-fastapi-staging`. |
| Variable | `FLY_STAGING_BASE_URL` | Optional | Defaults to `https://autoflow-fastapi-staging.fly.dev`. |
| Variable | `FLY_STAGING_SMOKE_USER_ID` | Optional | Defaults to `qa-smoke-user`. |

Fly.io recommends deploy tokens rather than broad auth tokens for CI/CD. Create the narrowest app-scoped token that can deploy this single app.

## Deploy

Automatic deploys run from `.github/workflows/deploy-fly-fastapi-staging.yml` when `staging` receives changes to:

- `backend/**`
- `docker/backend/Dockerfile`
- `fly.toml`
- `infra/scripts/fly_fastapi_smoke.sh`

Manual deploy:

1. Open the `Deploy FastAPI Fly.io Staging` workflow in GitHub Actions.
2. Run `workflow_dispatch`.
3. Confirm the `Validate FastAPI backend` job passes before the deploy job starts.

## Smoke verification

The workflow runs `infra/scripts/fly_fastapi_smoke.sh` against the live host after `flyctl deploy`.

The smoke script verifies:

- `GET /health`
- `POST /api/knowledge/bases`
- `GET /api/knowledge/bases`
- `PATCH /api/knowledge/bases/{id}`
- `POST /api/knowledge/bases/{id}/documents`
- `POST /api/knowledge/search`

Artifacts are uploaded to `fastapi-fly-staging-evidence-<run_id>` and include:

- `summary.md`
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
