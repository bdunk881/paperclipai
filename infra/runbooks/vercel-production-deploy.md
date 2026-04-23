# Runbook: Vercel Production Deployment

## Overview

The AutoFlow dashboard is a Vite/React SPA deployed to Vercel. Production builds
disable mock mode and connect to real backend APIs and Microsoft Entra External ID
for authentication.

## Vercel Environment Variables (Production)

Set these in the Vercel dashboard under **Project Settings → Environment Variables**
for the **Production** environment:

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
5. **Entra app registration:** Redirect URI updated to `https://app.helloautoflow.com`.

## Deploy

Deployment is automatic on push to `master` (when `dashboard/**` changes). Manual deploy:

```bash
# From repo root
cd dashboard
npx vercel pull --yes --environment=production --token=$VERCEL_TOKEN
npx vercel build --prod --token=$VERCEL_TOKEN
npx vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

Or trigger via GitHub Actions: **Actions → Deploy Dashboard to Vercel → Run workflow**.

## Verify

1. Open `https://app.helloautoflow.com` — should show login screen (not mock dashboard).
2. Sign in via Microsoft Entra — should redirect back and load real data.
3. Navigate to Workflows — should fetch from `/api/templates` (not mock data).
4. Check browser DevTools Network tab — no requests to `localhost`.

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
| `app.helloautoflow.com` | dashboard | Dashboard app |

### CloudFlare DNS Records (zone: `helloautoflow.com`)

| Type | Name | Target | Proxied |
|---|---|---|---|
| A | `helloautoflow.com` | `76.76.21.21` | No |
| CNAME | `www` | `cname.vercel-dns.com` | No |
| CNAME | `staging` | `cname.vercel-dns.com` | No |
| CNAME | `app` | `cname.vercel-dns.com` | No |

> **Important:** CloudFlare proxy must be **disabled** (grey cloud / DNS-only) for all
> Vercel-pointed records. Vercel must terminate TLS directly for its SSL certificates
> to provision and renew correctly.
