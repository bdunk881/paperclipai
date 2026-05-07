# Cloudflare Pages Git Migration

This runbook covers the `ALT-2404` migration path for the remaining Cloudflare Pages direct-upload projects, including the landing cutover tracked by `ALT-2437`.

## Scope

- `dashboard` -> `autoflow-dashboard-git`
- `staging` -> `autoflow-staging-git`
- `docs` -> `autoflow-docs-git`
- `landing` -> `autoflow-landing-git`

## Landing branch and domain policy

- The replacement landing project targets the `staging` branch, not `master`.
- This is intentional. As of `2026-05-04`, the latest recorded `READY` landing deployment in the migration audit was from `staging`, and both `origin/staging` and `origin/dev` now carry the RR7 landing build shape.
- The first Git-backed landing cutover binds `staging.helloautoflow.com`.
- `helloautoflow.com` and `www.helloautoflow.com` remain on the legacy direct-upload project until a separate production-domain decision confirms the final API/base-url env shape for apex traffic.

`docs/` now builds to a Pages-ready `build/client` artifact on `staging`. Use `staging` as the Git-backed production branch for the replacement docs project until the RR7 docs app is promoted to `master`; pointing the replacement project at `master` today would target a different app shape than the validated docs build.

## Prerequisites

- GitHub repo secrets:
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
  - `VITE_AZURE_TENANT_SUBDOMAIN`
- Optional preview-only secrets:
  - `APP_JWT_SECRET`
  - `QA_PREVIEW_ACCESS_TOKEN`

## Workflow

Use `.github/workflows/cloudflare-pages-migrate.yml`.

Inputs:

- `projects`: comma-separated list of project keys. Default `dashboard,staging`
- `apply_domains`: attach custom domains after the Git-backed projects are created or updated
- `retire_legacy`: delete the legacy direct-upload projects after the new projects own the domains

## What the workflow does

1. Creates or updates the Git-integrated Cloudflare Pages projects against `bdunk881/paperclipai`
2. Applies build settings and Cloudflare deployment env vars
3. Triggers the initial deployment if a target project has no deployment history
4. Waits for the latest deployment on each target project to succeed
5. Detaches configured domains from the legacy direct-upload project when needed
6. Attaches the domains to the Git-backed replacement project
7. Optionally deletes the legacy direct-upload project

## Project mapping

| Key | Project | Branch | Root dir | Output dir | Domain |
|---|---|---|---|---|---|
| `dashboard` | `autoflow-dashboard-git` | `master` | `dashboard` | `dist` | `app.helloautoflow.com` |
| `staging` | `autoflow-staging-git` | `staging` | `dashboard` | `dist` | `staging.app.helloautoflow.com` |
| `docs` | `autoflow-docs-git` | `staging` | `docs` | `build/client` | `docs.helloautoflow.com` |
| `landing` | `autoflow-landing-git` | `staging` | `landing` | `build/client` | `staging.helloautoflow.com` |

## Verification

- Check the GitHub Actions run for `cloudflare-pages-migrate.yml`
- In Cloudflare Pages, confirm the new projects show `Git` as the source
- Confirm the latest deployment status is `Success`
- Confirm custom domain status is `active`
- Smoke-test:
  - `https://app.helloautoflow.com/login`
  - `https://staging.app.helloautoflow.com/login`
  - `https://docs.helloautoflow.com/`
  - `https://docs.helloautoflow.com/api-reference`
  - `https://staging.helloautoflow.com/`
  - `https://staging.helloautoflow.com/blog`
  - `https://staging.helloautoflow.com/demo`
  - `https://staging.helloautoflow.com/signup`

## Rollback

- Re-attach the domain to the legacy direct-upload project if cutover failed and the legacy project still exists
- If the legacy project was deleted, recreate DNS/domain attachment back to the previous hosting target before user traffic resumes
- Re-run the workflow with `apply_domains=false` if you only need to refresh project config without domain movement
