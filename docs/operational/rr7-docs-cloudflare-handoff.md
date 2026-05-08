# ALT-2330 RR7 docs deployment handoff

## Current app shape

- Package path: `docs/`
- Runtime: React Router v7 framework mode with `ssr: true`
- Static routes currently ported: `/`, `/getting-started`, `/api-reference`, `/integrations-sdk-v1`
- Styling: existing Tailwind-based docs shell preserved with the approved reading-first light surface

## Local commands

```bash
cd docs
npm install
npm run dev
npm run typecheck
npm run build
```

## Cloudflare Pages handoff notes

- React Router framework-mode SSR is enabled in `react-router.config.ts`.
- Deployment should use a React Router / Cloudflare-compatible runtime template rather than the retired Next.js + Vercel setup.
- Static pre-rendering is enabled for the four public docs routes to keep the docs shell fast even with SSR on.
- The old `vercel.json`/Next runtime config has been removed as part of the RR7 port.
- The current public RR7 docs surface is fully pre-rendered, so Cloudflare Pages can publish `build/client` directly without a custom Worker for this phase.
- GitHub Actions workflow: `.github/workflows/docs-cloudflare-pages.yml`
- Expected Cloudflare Pages project name: `autoflow-docs`
- Required GitHub repository secrets:
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
- Preview deployments are available from pull requests or manual dispatches on non-`migration` branches.
- Production deployment should run from the `migration` branch once the Pages project production branch is configured accordingly.

## Known follow-up

- `docs/integrations/*.md` exists as file-backed content, but those guides are not yet exposed as public routes in this port.
- Reason: the approved design direction requires every public integration page to use a canonical logo asset, and the brand repo currently only contains a partial integration logo set.
- Before exposing those guides, source missing canonical assets for at least: Apollo, Datadog, DocuSign, Intercom, PostHog, and Shopify.
