# Runbook: Vercel Dashboard Deployment

## Overview

The AutoFlow dashboard is a Vite/React SPA deployed to Vercel. Production builds
disable mock mode and connect to real backend APIs and Microsoft Entra External ID
for authentication.

## Vercel Environment Variables

Set these in the Vercel dashboard under **Project Settings → Environment Variables**.
`Production` is used by `app.helloautoflow.com`; `Preview` backs branch deployments and
the `staging.app.helloautoflow.com` alias.

| Variable | Value | Source |
|---|---|---|
| `VITE_USE_MOCK` | `false` | Committed in `.env.production` — no Vercel override needed |
| `VITE_API_URL` | `https://api.helloautoflow.com` | Backend API base URL |
| `VITE_AZURE_CLIENT_ID` | *(from Azure Portal)* | Entra External ID app registration client ID |
| `VITE_AZURE_TENANT_SUBDOMAIN` | *(from Azure Portal)* | Entra tenant subdomain (e.g. `autoflow`) |

> **Note:** `VITE_*` variables are embedded at build time by Vite. Changing them
> requires a redeploy — they are not read at runtime.

## Pre-Deploy Checklist

1. **Security fixes merged:** Confirm branches with C-2 (`requireAuth` on `/api/runs/file`) and C-3 (JWT identity replacing `X-User-Id`) are merged to master.
2. **Environment variables set:** All four `VITE_*` variables configured in Vercel.
3. **Backend API reachable:** `https://api.helloautoflow.com/api/templates` returns 200.
4. **DNS configured:** `app.helloautoflow.com` CNAME points to `cname.vercel-dns.com`.
5. **Staging DNS configured:** `staging.app.helloautoflow.com` points to Vercel, not Azure Static Web Apps.
6. **Entra app registration:** Redirect URI updated to both `https://app.helloautoflow.com` and `https://staging.app.helloautoflow.com`.

## Deploy

Deployment is automatic:

- Push to `staging` with `dashboard/**` changes: `.github/workflows/dashboard-staging-gate.yml`
  creates a Vercel deployment and aliases it to `staging.app.helloautoflow.com`.
- Push to `master` with `dashboard/**` changes: the same workflow deploys Vercel production
  and updates `app.helloautoflow.com`.

The dashboard's same-origin `/api/*` traffic must rewrite to `https://api.helloautoflow.com/api/:path*` in [`dashboard/vercel.json`](../../dashboard/vercel.json) so production never points at the staging container app.

Backend production deploys should also be automatic on push to `master` via `.github/workflows/deploy-azure.yml`; only use the manual workflow dispatch path when you intentionally need a one-off staging or production redeploy.

Manual deploy:

```bash
# From repo root
cd dashboard
npx vercel pull --yes --environment=production --token=$VERCEL_TOKEN
npx vercel build --prod --token=$VERCEL_TOKEN
npx vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

Or trigger via GitHub Actions: **Actions → Deploy Dashboard to Vercel → Run workflow**.

## Verify

1. Open `https://app.helloautoflow.com` and `https://staging.app.helloautoflow.com` — both should show the login screen.
2. `POST https://app.helloautoflow.com/api/create-checkout-session` should return JSON or a controlled 4xx/5xx from the function, not SPA HTML.
3. `POST https://staging.app.helloautoflow.com/api/create-checkout-session` should return JSON or a controlled 4xx/5xx from the function, not SPA HTML or `Allow: GET, HEAD, OPTIONS`.
4. Sign in via Microsoft Entra on both hosts — redirect should return to the same host and load real data.
5. Check browser DevTools Network tab — no requests to `localhost`.

## Rollback

Vercel supports instant rollback:

1. Go to **Vercel Dashboard → Deployments**.
2. Find the last known-good deployment.
3. Click **⋮ → Promote to Production**.

No code change or rebuild required.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Login page shows but auth fails | `VITE_AZURE_CLIENT_ID` or `VITE_AZURE_TENANT_SUBDOMAIN` wrong | Verify values match Azure Portal; redeploy |
| API calls return 404 | API rewrite not matching | Check `vercel.json` rewrites; verify backend is running |
| Staging `/api/*` returns SPA HTML or `405 Allow: GET, HEAD, OPTIONS` | `staging.app.helloautoflow.com` still points to Azure Static Web Apps | Repoint the staging DNS record to Vercel, then redeploy the `staging` branch so the alias is refreshed |
| Mock data still showing | `VITE_USE_MOCK` is `true` | Confirm `.env.production` has `false`; check no Vercel env override |
| CORS errors | Backend not allowing dashboard origin | Add `https://app.helloautoflow.com` to backend CORS config |

---

## Custom Domains

### Domain Mapping (as of 2026-04-05)

| Domain | Vercel Project | Purpose |
|---|---|---|
| `helloautoflow.com` | autoflow-landing | Landing page (primary) |
| `www.helloautoflow.com` | autoflow-landing | 308 redirect → `helloautoflow.com` |
| `staging.helloautoflow.com` | autoflow-landing | Landing page (staging) |
| `staging.app.helloautoflow.com` | dashboard | Dashboard staging alias |
| `app.helloautoflow.com` | dashboard | Dashboard app |

### CloudFlare DNS Records (zone: `helloautoflow.com`)

| Type | Name | Target | Proxied |
|---|---|---|---|
| A | `helloautoflow.com` | `76.76.21.21` | No |
| CNAME | `www` | `cname.vercel-dns.com` | No |
| CNAME | `staging` | `cname.vercel-dns.com` | No |
| CNAME | `staging.app` | `cname.vercel-dns.com` | No |
| CNAME | `app` | `cname.vercel-dns.com` | No |

> **Important:** CloudFlare proxy must be **disabled** (grey cloud / DNS-only) for all
> Vercel-pointed records. Vercel must terminate TLS directly for its SSL certificates
> to provision and renew correctly.
