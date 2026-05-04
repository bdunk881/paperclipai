# Phase 0: Sanity Webhook Configuration

> Phase 0 deliverable for [ALT-2302](/ALT/issues/ALT-2302). Prepared for [ALT-2310](/ALT/issues/ALT-2310) on 2026-05-04.

## Scope

Document the current Sanity -> Vercel rebuild path for the landing site and define the replacement plan for Sanity -> Cloudflare Pages deploy hooks.

## Current State

### Repo-verified application facts

- The Sanity-backed site is the `landing` Next.js app.
- Sanity is configured through `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, and `SANITY_API_TOKEN` in [landing/lib/sanity.ts](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/landing/lib/sanity.ts:7).
- The default Sanity dataset in code is `production` when `NEXT_PUBLIC_SANITY_DATASET` is unset.
- The landing build on Vercel runs `npm run build` with Next.js in region `iad1`, per [landing/vercel.json](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/landing/vercel.json:1).
- The GitHub deploy workflow for the landing app triggers on `landing/**` changes pushed to `main` or `master`, per [.github/workflows/vercel.yml](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/.github/workflows/vercel.yml:1).
- The Vercel landing project is `autoflow-landing`, with domains `helloautoflow.com`, `www.helloautoflow.com`, and `staging.helloautoflow.com`.

### Current publish behavior

- The landing app reads blog and marketing content from Sanity in [landing/lib/sanity.ts](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/landing/lib/sanity.ts:25).
- There is no repo evidence of `revalidatePath`, `revalidateTag`, or route-level `revalidate` exports in `landing/`.
- Based on that code shape and the ALT-2310 task framing, content freshness is currently treated as full-site rebuild driven by a Sanity webhook rather than route-level on-demand revalidation.

### Current webhook configuration status

- Sanity project ID: not committed to git. It must be read from the live Sanity project settings or deployment env.
- Sanity dataset: effectively `production` unless the deployment overrides `NEXT_PUBLIC_SANITY_DATASET`.
- Webhook endpoint URL: not stored in this repo. The exact live Vercel deploy hook URL must be read from Sanity project settings or the Vercel project deploy-hook settings.
- Triggered Vercel project: `autoflow-landing`.
- Filtering logic: not represented in git. The live Sanity webhook may be unfiltered or dataset-filtered; verify in the Sanity dashboard before cutover.

### Latency note for the current flow

- The exact Sanity publish -> webhook delivery delay is not observable from git.
- The latest sampled production deployment for `autoflow-landing` reached `READY` about 39 seconds after the pushed commit timestamp and about 34 seconds after build start, based on Vercel deployment `dpl_6fYyecfTyTf75oYD71Gc3kKKezVr` on 2026-05-04.
- Practical current-state expectation: once the webhook fires, Vercel publish latency is on the order of tens of seconds, not minutes, unless builds queue or fail.

## Replacement Plan

### Target flow

Sanity webhook -> Cloudflare Pages deploy hook -> full Pages rebuild for the landing site.

### Cloudflare Pages deploy hook setup

1. In Cloudflare, open Workers & Pages and select the replacement landing Pages project.
2. Go to `Settings -> Builds -> Add deploy hook`.
3. Create a hook name such as `sanity-production`.
4. Set the branch to the branch Cloudflare should build for the landing site.
5. Copy the generated deploy hook URL.

Cloudflare's deploy hook is a unique unauthenticated URL, so it must be treated like a secret and rotated if exposed.

### Sanity webhook setup

1. In the Sanity project, open `Settings -> API -> Webhooks`.
2. Create or update the webhook so the destination URL is the Cloudflare Pages deploy hook URL.
3. Restrict the webhook to the `production` dataset unless a broader scope is intentionally required.
4. Preserve any existing document filter from the current webhook if one exists.
5. Keep the request method as `POST`.

### Recommended filter policy

- Minimum safe parity: dataset-restrict the webhook to `production`.
- If the current webhook is document-filtered, carry the same filter forward rather than broadening scope during migration.
- If no filter exists today, Phase 0 should not invent one. Record the live setting, then decide in a later phase whether narrower document-type filters reduce unnecessary rebuilds.

### Expected latency after cutover

- The webhook will still trigger a full-site rebuild, so freshness remains deployment-bound rather than request-bound.
- Cloudflare Pages deploy-hook latency should be measured in Phase 4c with a publish test, but the user-visible order of magnitude should remain "tens of seconds plus build time", not instant per-document invalidation.

## Risk Note

- The replacement path is rebuild-based. It does not preserve Vercel-style Next.js workflow assumptions around route-level ISR or on-demand revalidation.
- On the current codebase, this is likely acceptable because the landing app shows no repo-level use of `revalidatePath`, `revalidateTag`, or explicit route `revalidate` settings.
- The real tradeoff is operational: a content publish rebuilds the site artifact instead of invalidating only the affected route.
- Acceptability must be validated in Phase 4c by timing a real publish from Sanity to live content on the Cloudflare host.

## Cutover Checklist

- Read the live Sanity webhook and capture:
  - exact destination URL
  - dataset scope
  - document filter, if any
  - request method
- Create the Cloudflare Pages deploy hook for the target landing project and branch.
- Replace the Sanity destination URL with the Cloudflare deploy hook URL.
- Publish a controlled Sanity content change.
- Measure:
  - publish timestamp in Sanity
  - deployment start timestamp in Cloudflare
  - deployment ready timestamp in Cloudflare
  - first observed live content timestamp on the public site
- Record the measured latency in Phase 4c before removing the Vercel fallback path.

## Sources

- Repo:
  - [landing/lib/sanity.ts](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/landing/lib/sanity.ts:1)
  - [landing/vercel.json](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/landing/vercel.json:1)
  - [.github/workflows/vercel.yml](/Users/bradduncan/.paperclip/instances/default/projects/f998f95d-8cea-4c90-a1e2-5d40da90bde1/fc4e6e53-0340-486b-8aa3-9ef2579a0687/paperclipai/.github/workflows/vercel.yml:1)
- Official docs:
  - Cloudflare Pages deploy hooks: https://developers.cloudflare.com/pages/configuration/deploy-hooks/
  - Sanity webhooks and GROQ filters: https://www.sanity.io/docs/content-lake/webhooks
  - Vercel build behavior: https://vercel.com/docs/builds
