# Runbook: Cloudflare Pages Phase 4 Cutover

Validated on 2026-05-04 for `ALT-2329`.

## Objective

Support Phase 4 frontend migration from Azure Static Web Apps and Vercel to Cloudflare Pages for:

- `app.helloautoflow.com`
- `docs.helloautoflow.com`
- `helloautoflow.com`
- `www.helloautoflow.com`

Frontend owns the application migration to React Router 7. This runbook covers DevOps-owned hosting, environment, DNS, and retirement sequencing.

## Validated Current State

### Cloudflare

- Zone `helloautoflow.com` is active in Cloudflare.
- Cloudflare account `ac4c4bbeba11a92f96406a7d38a3b544` already has these Pages projects:

| Project | `pages.dev` host | Production branch | Source wiring | Deployments | Project env config |
|---|---|---|---|---|---|
| `autoflow-dashboard` | `autoflow-dashboard.pages.dev` | `migration` | none | none | none |
| `autoflow-docs` | `autoflow-docs.pages.dev` | `migration` | none | none | none |
| `autoflow-landing` | `autoflow-landing.pages.dev` | `migration` | none | none | none |

These projects are placeholders today. They still need CI deployment wiring and environment configuration before they can receive production traffic.

### Vercel

Active Vercel production domain attachments:

| Vercel project | Active domains |
|---|---|
| `dashboard` | `app.helloautoflow.com`, `staging.app.helloautoflow.com` |
| `autoflow-landing` | `helloautoflow.com`, `www.helloautoflow.com`, `staging.helloautoflow.com` |
| `autoflow-docs` | none |

### DNS

Current Cloudflare DNS records still route production frontend traffic to Vercel:

| Host | Current record |
|---|---|
| `helloautoflow.com` | `A 76.76.21.21` |
| `www.helloautoflow.com` | `CNAME cname.vercel-dns.com` |
| `app.helloautoflow.com` | `CNAME da5eacc881226353.vercel-dns-017.com` |
| `docs.helloautoflow.com` | not present |

## Deployment Model

Use Cloudflare Pages direct upload from GitHub Actions with Wrangler:

```bash
npx wrangler pages deploy <output-dir> --project-name=<project-name>
```

This matches the current Pages project state, keeps builds in repo-owned CI, and avoids manual dashboard deploys. Do not rely on ad hoc drag-and-drop uploads.

Required GitHub Actions secrets for all three projects:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier for Pages API operations |
| `CLOUDFLARE_API_TOKEN` | Token with Pages project and zone DNS permissions |

## Project Requirements

### Dashboard: `autoflow-dashboard`

Path: `dashboard/`

Target model:

- React Router 7 SPA build deployed as static assets to `autoflow-dashboard`
- Production host: `app.helloautoflow.com`

Required build-time variables for the migrated dashboard:

| Variable | Type | Notes |
|---|---|---|
| `VITE_API_BASE_URL` or `VITE_API_URL` | public build-time | API origin used by frontend HTTP clients |
| `VITE_AZURE_CIAM_TENANT_SUBDOMAIN` | public build-time | current auth code reads this name |
| `VITE_AZURE_CIAM_TENANT_DOMAIN` | public build-time, optional | only needed if tenant domain cannot be derived |
| `VITE_SENTRY_DSN` | public build-time, optional | keep if Sentry remains enabled after migration |

Notes:

- `VITE_USE_MOCK=false` is already committed in `dashboard/.env.production`.
- Do not blindly mirror the current Vercel environment list. The Vercel project contains legacy Azure, Supabase, QA-preview, and preview-only keys that are not all part of the RR7 production target.

### Docs: `autoflow-docs`

Path: `docs/`

Target model:

- React Router 7 framework-mode docs app deployed to `autoflow-docs`
- Production host: `docs.helloautoflow.com`

Current repo state:

- `docs/` is still a Next.js app today.
- No production Vercel domains or project env vars are currently attached to docs.

Required environment variables:

- None are referenced by the current repo under `docs/`.
- If the RR7 docs app introduces analytics, search, or content API access, add only those keys when the frontend migration lands.

### Landing: `autoflow-landing`

Path: `landing/`

Target model:

- React Router 7 framework-mode landing site deployed to `autoflow-landing`
- Production hosts: `helloautoflow.com` and `www.helloautoflow.com`

Current application-secret requirements derived from repo usage and current Vercel production config:

| Variable | Type | Consumer |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | public | checkout success/cancel URLs, sitemap, robots |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | public | Sanity read client |
| `NEXT_PUBLIC_SANITY_DATASET` | public | Sanity read client |
| `SANITY_API_TOKEN` | secret | server-side Sanity access |
| `STRIPE_SECRET_KEY` | secret | checkout + webhook routes |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe webhook verification |
| `STRIPE_FLOW_PRICE_ID` | public/server config | pricing lookup |
| `STRIPE_AUTOMATE_PRICE_ID` | public/server config | pricing lookup |
| `STRIPE_SCALE_PRICE_ID` | public/server config | pricing lookup |
| `RESEND_API_KEY` | secret | email sends |
| `RESEND_AUDIENCE_ID` | secret/config | audience sync |
| `PAPERCLIP_API_URL` | secret/config | Stripe webhook follow-up issue creation |
| `PAPERCLIP_WEBHOOK_API_KEY` | secret | Paperclip webhook auth |
| `PAPERCLIP_COMPANY_ID` | secret/config | webhook target scoping |
| `PAPERCLIP_CSM_AGENT_ID` | secret/config | onboarding issue routing |
| `PAPERCLIP_ONBOARDING_GOAL_ID` | secret/config | onboarding issue routing |
| `ZAPIER_WEBHOOK_URL` | secret | subscribe route |
| `ZAPIER_BETA_SIGNUP_WEBHOOK_URL` | secret | beta signup route |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | public, optional | analytics |

Notes:

- The current landing implementation is still Next.js. Reconfirm the exact variable names after the RR7 port lands, but the external dependencies above remain the required capability set.
- Preserve `www` to apex redirect behavior before cutover. Do not move `www.helloautoflow.com` to Pages until the landing app can still issue a 308 redirect to `https://helloautoflow.com`.

## DNS Cutover Plan

Risk level: medium. Blast radius is customer-facing web traffic on three hosts.

### Preflight

Before changing any production hostname:

1. Deploy each migrated frontend to its `pages.dev` hostname and verify 200 responses:
   - `autoflow-dashboard.pages.dev`
   - `autoflow-docs.pages.dev`
   - `autoflow-landing.pages.dev`
2. Confirm Cloudflare Pages custom domain support is ready on the target project.
3. For `app.helloautoflow.com`, lower TTL from `600` to `60` at least 30 minutes before cutover.
4. Verify `www -> apex` redirect behavior on the landing build before touching `www.helloautoflow.com`.
5. Freeze production-domain edits in Vercel during the cutover window.

### Cutover Order

Use this order to reduce blast radius:

1. `docs.helloautoflow.com`
2. `app.helloautoflow.com`
3. `helloautoflow.com`
4. `www.helloautoflow.com`

Docs is first because it has no current production Vercel attachment. Landing is last because apex plus `www` is the highest-traffic and highest-risk switch.

### Per-Host Procedure

#### 1. Docs

1. Deploy docs to `autoflow-docs.pages.dev`.
2. Add `docs.helloautoflow.com` as a custom domain on `autoflow-docs`.
3. Verify Cloudflare creates and activates the DNS mapping.
4. Smoke test `/`, key docs routes, and any search/static asset paths.

Rollback:

- Remove the Pages custom domain and restore the previous DNS target if one existed.

#### 2. Dashboard

1. Deploy dashboard to `autoflow-dashboard.pages.dev`.
2. Verify auth bootstrap, API calls, and static asset loads on the `pages.dev` host.
3. Remove `app.helloautoflow.com` from the Vercel `dashboard` project.
4. Immediately add `app.helloautoflow.com` as a custom domain on `autoflow-dashboard`.
5. Verify:
   - login page loads
   - CIAM redirect completes
   - API requests still hit the production backend
   - no `pages.dev` asset or CORS regressions

Rollback:

1. Remove `app.helloautoflow.com` from Cloudflare Pages.
2. Re-attach the domain to the Vercel `dashboard` project.
3. Restore the previous CNAME target if Cloudflare did not automatically revert it.

#### 3. Landing Apex

1. Deploy landing to `autoflow-landing.pages.dev`.
2. Verify home page, pricing, blog, signup, webhook-backed forms, `robots.txt`, and `sitemap.xml`.
3. Remove `helloautoflow.com` from the Vercel `autoflow-landing` project.
4. Add `helloautoflow.com` as a custom domain on `autoflow-landing`.
5. Verify apex traffic, TLS issuance, and webhook-backed routes.

Rollback:

1. Remove apex from Cloudflare Pages.
2. Re-attach apex to Vercel.
3. Restore the original `A 76.76.21.21` if Cloudflare did not automatically restore it.

#### 4. `www`

1. Only proceed after apex is healthy.
2. Remove `www.helloautoflow.com` from the Vercel `autoflow-landing` project.
3. Add `www.helloautoflow.com` to `autoflow-landing`.
4. Verify it still returns a 308 redirect to `https://helloautoflow.com`.

Rollback:

- Re-attach `www` to Vercel and restore the prior redirect there.

## Vercel Retirement Sequence

Do not delete Vercel projects at the moment of DNS cutover. Retire in this order:

1. Remove production custom domains from Vercel once the equivalent Pages hostname is healthy.
2. Keep the Vercel projects and deployments for at least one observation window after cutover.
3. Disable or replace production Vercel workflows:
   - `.github/workflows/vercel.yml`
   - `.github/workflows/dashboard-staging-gate.yml`
   - `.github/workflows/vercel-dashboard-status-sync.yml`
4. Remove Vercel project environment variables that are no longer used by the migrated frontend.
5. Delete the `dashboard` and `autoflow-landing` Vercel projects only after:
   - production Pages traffic is stable
   - rollback is no longer needed
   - preview/staging needs have moved off Vercel

Notes:

- `autoflow-docs` currently has no attached Vercel production domain, so there is no production retirement action there.
- `staging.app.helloautoflow.com` and `staging.helloautoflow.com` are outside the production-host cutover scope and should be reviewed separately before deleting any remaining Vercel staging flows.

## Verification Checklist

Immediately after each hostname cutover, verify:

- DNS record resolves to the expected Cloudflare-managed target
- TLS is valid
- primary route returns `200`
- expected redirects still return `308`
- static assets load without mixed-content or CSP regressions
- auth and API flows succeed on dashboard
- webhook-backed forms and checkout flows succeed on landing

## Follow-On Infra Work

This runbook is the support contract for frontend migration work. Remaining implementation tasks after the frontend RR7 ports land:

1. Add Pages deployment workflows for dashboard, docs, and landing.
2. Populate GitHub Actions and Pages environment variables with the app-specific sets above.
3. Execute cutovers in the order above.
4. Remove obsolete Azure SWA and Vercel production workflows after successful cutover.
