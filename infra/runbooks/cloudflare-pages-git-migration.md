# Cloudflare Pages Git Migration

This runbook covers the `ALT-2404` migration path for the remaining Cloudflare Pages direct-upload projects.

## Scope

- `dashboard` -> `autoflow-dashboard-git`
- `staging` -> `autoflow-staging-git`

## Current blocker

`landing/` is not Pages-static today. It has live Next.js server routes under `landing/app/api/*`, including Stripe checkout, Stripe webhooks, and signup handlers. Cloudflare's current Pages static Next.js path supports static exports, while full-stack Next.js needs a Workers/OpenNext migration rather than a static Pages import.

Do not cut `helloautoflow.com` or `www.helloautoflow.com` to a Pages project until that app-level migration is completed.

`docs/` is also blocked for now. Its Pages-style static export currently fails during generated error-page prerendering, so it needs a small app-level Next.js fix before moving off the legacy direct-upload Pages project.

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
3. Waits for the latest deployment on each target project to succeed
4. Detaches configured domains from the legacy direct-upload project when needed
5. Attaches the domains to the Git-backed replacement project
6. Optionally deletes the legacy direct-upload project

## Project mapping

| Key | Project | Branch | Root dir | Output dir | Domain |
|---|---|---|---|---|---|
| `dashboard` | `autoflow-dashboard-git` | `master` | `dashboard` | `dist` | `app.helloautoflow.com` |
| `staging` | `autoflow-staging-git` | `staging` | `dashboard` | `dist` | `staging.app.helloautoflow.com` |

## Verification

- Check the GitHub Actions run for `cloudflare-pages-migrate.yml`
- In Cloudflare Pages, confirm the new projects show `Git` as the source
- Confirm the latest deployment status is `Success`
- Confirm custom domain status is `active`
- Smoke-test:
  - `https://app.helloautoflow.com/login`
  - `https://staging.app.helloautoflow.com/login`

## Rollback

- Re-attach the domain to the legacy direct-upload project if cutover failed and the legacy project still exists
- If the legacy project was deleted, recreate DNS/domain attachment back to the previous hosting target before user traffic resumes
- Re-run the workflow with `apply_domains=false` if you only need to refresh project config without domain movement
