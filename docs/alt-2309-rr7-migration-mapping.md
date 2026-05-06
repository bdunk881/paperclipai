# ALT-2309 Phase 0: Next.js -> React Router 7 Migration Mapping

This document inventories the Next.js features currently used in `landing/` and `docs/`, then maps each feature to the React Router 7 (RR7) equivalent needed for the migration branch work tracked by [ALT-2302](/ALT/issues/ALT-2302).

## Executive summary

- Both sites are on the Next.js App Router, not the legacy Pages Router.
- `docs/` is a low-risk static App Router site with no MDX pipeline, no API routes, and no dynamic segments.
- `landing/` carries the real migration surface: dynamic blog routing, Sanity-backed server fetches, local markdown fallbacks, `next/image`, metadata generation, sitemap/robots generation, and App Router route handlers under `app/api/*`.
- Phase 0 risk is concentrated in two places:
  - Sanity-backed content and image rendering for the blog
  - Replacing Next-specific APIs (`next/image`, metadata files, route handlers) with RR7 + Cloudflare-native equivalents

## Current surface inventory

| Site | Router model | Dynamic routes | Data sources | API routes | Metadata files |
|---|---|---|---|---|---|
| `landing/` | App Router | `app/blog/[slug]/page.tsx` | Sanity + local markdown fallback + env-backed APIs | Yes (`app/api/*/route.ts`) | `layout.tsx`, `generateMetadata`, `sitemap.ts`, `robots.ts` |
| `docs/` | App Router | None | Static TSX content only | None | `layout.tsx` metadata only |

## Feature mapping

| Feature | Current usage | RR7 equivalent | Status | Notes |
|---|---|---|---|---|
| Router model | Both apps use App Router file conventions under `app/` | RR7 route modules declared in `routes.ts` or file-route layout, with nested layouts and route modules | ✅ Clean equivalent | No Pages Router migration needed first. |
| Static pages | `docs/app/page.tsx`, `docs/app/getting-started/page.tsx`, `landing/app/privacy/page.tsx`, `landing/app/terms/page.tsx` | Plain RR7 route modules returning JSX; no loader required unless data is introduced | ✅ Clean equivalent | Mostly mechanical file moves. |
| Dynamic routes | `landing/app/blog/[slug]/page.tsx` | RR7 dynamic route like `blog/:slug` with `loader({ params })` | ✅ Clean equivalent | `params` usage already follows async App Router style, so the data flow is straightforward to port. |
| Catch-all routes | None in `landing/` or `docs/` | None required | ✅ Clean equivalent | No `[...slug]` or `[[...slug]]` behavior to preserve. |
| Middleware / request interception | No `middleware.ts` exists in either app | None required initially; add RR7/Cloudflare middleware only if auth, rewrites, or bot controls are needed later | ✅ Clean equivalent | There is no existing middleware logic to translate. |
| Server-rendered page data | Landing blog and blog index fetch on the server from `landing/lib/sanity.ts`; docs pages are static | RR7 `loader` per route, returning JSON/data consumed by route components | ✅ Clean equivalent | `getBlogPosts`, `getBlogPost`, and any env-backed reads move naturally into loaders. |
| Client-side UI state | `landing/app/page.tsx` is a client component for waitlist form state | RR7 component state with `useState`, or `<Form>`/`useFetcher` if form mutations are moved to actions | ✅ Clean equivalent | This is React-level logic, not Next-specific logic. |
| `generateStaticParams` | `landing/app/blog/[slug]/page.tsx` prebuilds local markdown slugs only | RR7 prerender config or build-time route generation if static output is required; otherwise keep dynamic loader on Cloudflare | ⚠️ Works with adjustment | Current implementation ignores Sanity slugs, so the migration should decide whether blog pages are fully dynamic or generated from a CMS export step. |
| `generateMetadata` | `landing/app/blog/[slug]/page.tsx` computes title/description per slug | RR7 route `meta()` fed by loader data | ✅ Clean equivalent | The same blog fetch can power both loader output and route metadata. |
| Root metadata | `landing/app/layout.tsx` and `docs/app/layout.tsx` define title/description/Open Graph defaults | RR7 root route `meta()` and shared layout route | ✅ Clean equivalent | Direct conceptual mapping. |
| Sitemap | `landing/app/sitemap.ts` builds two URLs from `NEXT_PUBLIC_BASE_URL` | RR7 resource route serving `/sitemap.xml`, or static file generated at build/deploy time | ⚠️ Works with adjustment | Current sitemap omits blog detail pages, so this is already incomplete and should be corrected during migration. |
| `robots.txt` | `landing/app/robots.ts` returns typed robots config | RR7 resource route serving `text/plain` at `/robots.txt`, or static file | ✅ Clean equivalent | Simple rewrite. |
| Open Graph images | Layout metadata defines OG text, but there is no file-based OG image generator like `opengraph-image.tsx` | RR7 `meta()` pointing at static OG assets, or a Worker/resource route for generated OG images | ⚠️ Works with adjustment | No blocker, but RR7 will not supply Next metadata file conventions automatically. |
| Route handlers / API endpoints | Landing has App Router endpoints in `app/api/checkout/route.ts`, `subscribe/route.ts`, `waitlist-signup/route.ts`, `beta-signup/route.ts`, and `stripe/webhook/route.ts` | RR7 resource routes and `action()` handlers, or separate Cloudflare Worker endpoints | ✅ Clean equivalent | Webhooks and public APIs fit RR7 resource routes well. UI-driven mutations can use route actions/fetchers. |
| Raw webhook body handling | `landing/app/api/stripe/webhook/route.ts` reads `req.text()` and also exports legacy `config.api.bodyParser = false` | RR7 resource route reading `request.text()` directly | ⚠️ Works with adjustment | The exported `config` is a legacy Pages Router pattern and can be removed during migration. |
| Sanity integration | `landing/lib/sanity.ts` creates the client and performs GROQ fetches for homepage sections and blog content | Shared server-only utility consumed by RR7 loaders | ⚠️ Works with adjustment | Keep the client server-side; do not move GROQ fetches into browser bundles. |
| Local markdown fallback | `landing/lib/articles.ts` reads `../content/articles/*.md` from disk and the blog route renders via a minimal markdown transformer | RR7 loader can keep filesystem reads in Node-compatible builds, or content can be normalized into Sanity/build artifacts | ⚠️ Works with adjustment | File I/O is workable on Node, but needs explicit validation if landing moves to a Cloudflare-only runtime. |
| MDX configuration | No active MDX setup exists in either app; only Tailwind globs include `*.mdx` | Either continue with plain TSX/static content, or add RR7 MDX tooling deliberately later | ✅ Clean equivalent | There is nothing to port today. |
| `next/image` local assets | `landing/app/page.tsx` uses `next/image` for integration logos and other static visuals | RR7 with standard `<img>` or a framework image component from the chosen RR7 stack/CDN | ⚠️ Works with adjustment | Next image optimization disappears; asset dimensions and lazy loading must be set explicitly. |
| `next/image` remote CMS assets | `landing/app/blog/[slug]/page.tsx` renders Sanity images through `urlFor(...)` and `next/image` | Cloudflare image delivery, pre-sized Sanity CDN URLs, or responsive `<img>/<picture>` | 🚨 Risk item | This is the biggest media migration risk because RR7 has no built-in `next/image` pipeline and the current app has no explicit remote image config in `landing/next.config.ts`. |
| `next/font` | `landing/app/layout.tsx` imports `Inter` and `JetBrains_Mono` from `next/font/google` | Self-host fonts through RR7 assets/CSS, or use a font package/CDN with preload rules | ⚠️ Works with adjustment | Straightforward, but font loading strategy must be replaced intentionally. |
| Error boundaries | `landing/app/error.tsx` and `landing/app/not-found.tsx` are App Router error files | RR7 route `ErrorBoundary` and catch/404 handling in route modules | ✅ Clean equivalent | Direct RR7 concept exists. |

## Site-by-site notes

### `docs/`

`docs/` is almost entirely static. It has:

- root metadata in `docs/app/layout.tsx`
- three content pages under `docs/app/*/page.tsx`
- a shared shell in `docs/components/DocsLayout.tsx`

It does **not** have:

- MDX compilation
- CMS reads
- route handlers
- dynamic segments
- sitemap or robots generation

Assessment: `docs/` should migrate first once RR7 framework patterns are chosen, because it is the cleanest validation target after the dashboard work.

### `landing/`

`landing/` contains the migration-sensitive pieces:

- dynamic blog route with `generateMetadata` and `generateStaticParams`
- Sanity fetch helpers in `landing/lib/sanity.ts`
- filesystem article fallback in `landing/lib/articles.ts`
- App Router API/webhook routes under `landing/app/api/*`
- `next/image` usage for both local assets and Sanity-driven remote assets
- metadata conventions in `layout.tsx`, `sitemap.ts`, and `robots.ts`

Assessment: this app is compatible with RR7 conceptually, but not a search-and-replace migration. The content, metadata, and image path need deliberate replacement decisions first.

## Phase 0 risk items that need explicit resolution

### 1. Remote image strategy for Sanity blog content

Status: 🚨 Risk item

Why it is risky:

- RR7 does not provide a `next/image` equivalent out of the box.
- Blog post Portable Text images currently depend on Sanity URL generation plus Next image rendering.
- `landing/next.config.ts` does not define a remote image allowlist, so the current implementation already deserves verification.

Phase 0 resolution required:

- Decide whether landing images will use:
  - direct Sanity CDN URLs with responsive `<img>`
  - Cloudflare image resizing
  - another dedicated image pipeline
- Document width, format, caching, and CLS handling for that choice.

### 2. Filesystem fallback for blog articles on Cloudflare-targeted hosting

Status: 🚨 Risk item

Why it is risky:

- `landing/lib/articles.ts` relies on `fs` and `path` against `../content/articles`.
- That is easy in a Node build environment, but not a free assumption if the landing site is pushed toward Cloudflare-native runtime constraints.

Phase 0 resolution required:

- Decide whether the markdown fallback remains build-time only, becomes bundled content, or is removed in favor of Sanity-only content.
- Verify the chosen RR7 deployment target supports the selected content-loading model.

## Recommended RR7 implementation shape

1. Build a shared RR7 server utility layer for Sanity and Stripe/webhook helpers.
2. Migrate `docs/` to static RR7 route modules with root `meta()` first.
3. Migrate `landing/` pages to RR7 route modules and use loaders for blog and any server-derived content.
4. Convert `app/api/*/route.ts` endpoints into RR7 resource routes or actions based on whether they are UI-triggered or third-party-triggered.
5. Replace `next/image` and `next/font` with explicit Cloudflare-compatible asset handling before landing cutover.
6. Treat blog content and image delivery as separate Phase 0 acceptance checks, not incidental implementation details.

## Recommended follow-up tasks

- Create a spike for Sanity image delivery in RR7/Cloudflare.
- Create a spike for filesystem markdown fallback viability on the target RR7 hosting path.
- Expand the sitemap plan so blog URLs are included after migration instead of preserving the current partial sitemap behavior.
