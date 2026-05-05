# Fly.io FastAPI staging and production cutover service

Use this runbook for the standalone FastAPI Fly.io services used for staging
validation and the production pre-cutover target prepared by
[ALT-2344](/ALT/issues/ALT-2344).

## Purpose

- Deploy the Python FastAPI staging app and the production pre-cutover Fly app.
- Verify the live service with health, knowledge, native auth, callback, and webhook smoke checks.
- Keep the staging rollout reproducible through GitHub Actions instead of ad hoc console changes.

## GitHub Actions configuration

Configure these values before running the workflow:

| Type | Name | Required | Notes |
|---|---|---|---|
| Secret | `FLY_API_TOKEN` | Yes | Prefer an app-scoped deploy token for `autoflow-fastapi-staging`. |
| Variable | `FLY_STAGING_APP_NAME` | Optional | Defaults to `autoflow-fastapi-staging`. |
| Variable | `FLY_STAGING_BASE_URL` | Optional | Defaults to `https://autoflow-fastapi-staging.fly.dev`. |
| Variable | `FLY_STAGING_SMOKE_USER_ID` | Optional | Defaults to `qa-smoke-user`. |
| Variable | `FLY_PRODUCTION_APP_NAME` | Optional | Defaults to `autoflow-fastapi-production`. |
| Variable | `FLY_PRODUCTION_BASE_URL` | Optional | Defaults to `https://autoflow-fastapi-production.fly.dev`. |
| Variable | `FLY_PRODUCTION_SMOKE_USER_ID` | Optional | Defaults to `qa-smoke-user`. |
| Variable | `FLY_PRODUCTION_RELAY_BASE_URL` | Optional | Direct legacy backend host for production relay checks. If omitted, the workflow temporarily relays to `https://api.helloautoflow.com` for pre-cutover smoke only. |

Fly.io recommends deploy tokens rather than broad auth tokens for CI/CD. The
production pre-cutover path needs a token that can deploy both FastAPI Fly apps
or create the production app if it does not exist yet.

## Deploy

Automatic staging deploys run from `.github/workflows/deploy-fly-fastapi-staging.yml`
when `staging` receives changes to:

- `backend/**`
- `docker/backend/Dockerfile`
- `fly.toml`
- `infra/scripts/fly_fastapi_smoke.sh`
- `backend/fly-cutover-probe-matrix.md`

Manual staging deploy:

1. Open the `Deploy FastAPI Fly.io Staging` workflow in GitHub Actions.
2. Run `workflow_dispatch`.
3. Choose `environment=staging`.
4. Confirm the `Validate FastAPI backend` job passes before the deploy job starts.

Manual production pre-cutover deploy:

1. Open the `Deploy FastAPI Fly.io` workflow in GitHub Actions.
2. Run `workflow_dispatch` against the `migration` branch or the release branch carrying the cutover commit.
3. Choose `environment=production`.
4. Optionally set `production_relay_base_url` to the direct legacy Azure ingress hostname if that value has already been captured.
5. Confirm the `Validate FastAPI backend` job passes before the deploy job starts.

If `production_relay_base_url` is omitted, the workflow relays to
`https://api.helloautoflow.com` for pre-cutover smoke against the Fly hostname
only. Before Stage 5a flips DNS, rerun the workflow with the direct Azure
ingress hostname so callbacks and webhooks do not loop back into Fly.

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

For production pre-cutover rollback, use the same flow against
`autoflow-fastapi-production` and record whether `FLY_PRODUCTION_RELAY_BASE_URL`
was pointing at the public production host or the direct legacy Azure ingress.
