# Cloudflare Pages Native Auth Routing

## Purpose

This runbook documents how native auth traffic reaches the Cloudflare Pages dashboard deployment for `app.helloautoflow.com`.

## Production routing model

- Cloudflare Pages project: `autoflow-dashboard-git`
- Production branch: `master`
- Build root: `dashboard`
- Build output: `dashboard/dist`
- Pages functions root: `dashboard/functions`
- Production custom domain: `app.helloautoflow.com`
- API origin for non-auth dashboard traffic: `https://api.helloautoflow.com`

`api.helloautoflow.com` remains on Fly.io. Only the native auth path is handled inside the dashboard Pages deployment:

- `OPTIONS /api/auth/native/*`
- `POST /api/auth/native/*`

The Pages function lives at `dashboard/functions/api/auth/native/[[path]].ts`. It:

- answers CORS preflight directly with HTTP `204`
- forwards allowed `POST` requests to Azure CIAM
- preserves correlation IDs for troubleshooting
- rejects unknown paths and disallowed browser origins

## Supporting projects

- `autoflow-dashboard-dev-git` serves `dev.app.helloautoflow.com`
- `autoflow-dashboard-staging-git` is reserved for a future staging cutover
- `autoflow-dashboard` is the legacy direct-upload project and should not receive new production auth routing changes

## Deployment workflow

Use `.github/workflows/dashboard-cloudflare-pages.yml`.

Branch-to-project mapping:

- `master` -> `autoflow-dashboard-git`
- `staging` -> `autoflow-dashboard-staging-git`
- `dev` -> `autoflow-dashboard-dev-git`

The workflow:

1. builds `dashboard`
2. deploys `dist` to the mapped Pages project
3. smokes the deployment URL
4. smokes the custom domain when one is configured for that branch

## Domain registration workflow

Use `.github/workflows/cf-pages-add-domains.yml`.

Current managed mappings:

- `app.helloautoflow.com` -> `autoflow-dashboard-git`
- `dev.app.helloautoflow.com` -> `autoflow-dashboard-dev-git`
- `docs.helloautoflow.com` -> `autoflow-docs`
- `www.helloautoflow.com` -> `autoflow-landing`

Cloudflare error code `8000018` means the domain is already registered and should be treated as success.

## Verification

### Inspect the project

Run `.github/workflows/cloudflare-pages-inspect.yml` with `project=autoflow-dashboard-git`.

Expected fields:

- `production_branch: "master"`
- `source_type: "github"`
- `build_config.root_dir: "dashboard"`
- `build_config.destination_dir: "dist"`

### Verify custom domain registration

Run `.github/workflows/cf-pages-add-domains.yml` with `dry_run=false`.

Expected result for production:

- success for `app.helloautoflow.com`, or
- error code `8000018` if it was already attached

### Smoke the native auth route

Run:

```bash
curl -i -X OPTIONS 'https://app.helloautoflow.com/api/auth/native/signup/v1.0/start' \
  -H 'Origin: https://app.helloautoflow.com' \
  -H 'Access-Control-Request-Method: POST'
```

Expected response:

- HTTP `204`
- `Access-Control-Allow-Origin: https://app.helloautoflow.com`
- `Access-Control-Allow-Methods: POST, OPTIONS`

## Failure modes

- `405` on `app.helloautoflow.com` usually means the domain still points at the legacy dashboard target instead of `autoflow-dashboard-git`
- `403` from the function means the browser origin is missing from `AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS`
- `400` from the function means the auth path is not in the allowlist or the request body is empty
- no deployments in project inspection means `master` has not yet produced a Git-backed Pages deployment
