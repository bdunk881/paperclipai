# AutoFlow landing site

The landing page at [helloautoflow.com](https://helloautoflow.com). Built as a React Router 7 app, deployed via Cloudflare Pages.

## Local dev

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view it. Edits to `app/page.tsx` (and its children in `app/components/`) hot-reload.

The page calls into the Express backend's public endpoints via `buildLandingApiUrl()` (see `landing/lib/publicApi.ts`):

- `POST /api/public/landing/waitlist-signup`
- `POST /api/public/landing/subscribe`
- `POST /api/public/landing/checkout` (Stripe checkout session)

Locally, requests fall back to `http://localhost:3000` (the Express dev port). In production they go to `https://api.helloautoflow.com` via `NEXT_PUBLIC_API_URL` set at build time on Cloudflare Pages.

## Deploy

Pushes to `dev` / `staging` / `master` trigger `.github/workflows/landing-cloudflare-pages.yml`, which builds with Vite and deploys to the matching Cloudflare Pages project. The landing replaced the legacy Vercel deployment (retired alongside the dashboard Vercel target).

## Layout

```
landing/
  app/                # React Router routes (page.tsx, signup/, blog/, demo/, privacy/, terms/)
  app/components/     # Section components used by page.tsx
  lib/                # publicApi.ts, resend.ts (helpers)
  public/             # static assets copied verbatim to the deploy
```

The design tokens + the `.lp-*` / `.af2-*` classes live in `app/v2.css`. The page renders at build time with zero runtime data fetching — Cloudflare Pages prerenders it to static HTML.
