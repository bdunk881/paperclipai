# Landing RR7 Preview Gate

As of 2026-05-05, RR7 landing pull requests should keep using the `autoflow-landing`
Vercel preview as the merge gate until a landing-specific Cloudflare Pages project
and preview workflow exist in this repo.

## Decision

- Keep Vercel as the preview gate for RR7 landing PRs.
- Keep Cloudflare Pages as the intended long-term hosting target for the landing
  migration.

## Rationale

- The current RR7 landing app already builds successfully with `react-router build`
  and produces the standard `build/client` plus `build/server` output expected by
  React Router framework deployments.
- Vercel's current React Router documentation supports framework-mode SSR deployments
  directly and recommends the `@vercel/react-router` preset.
- There is no landing-specific Cloudflare Pages preview workflow or Pages project
  configuration checked into this repository yet, so switching the PR gate today
  would create a gap instead of closing one.

## Required config for RR7 previews

- Remove the stale Next.js-specific `framework` and `outputDirectory` settings from
  `landing/vercel.json`.
- Add the Vercel React Router preset in `landing/react-router.config.ts`.

## Follow-up

- When the landing Pages project and preview workflow are added, replace the Vercel
  preview gate with Cloudflare Pages evidence and retire the `autoflow-landing`
  Vercel PR gate.
