# SEO/AEO Agent — Logbook

Running audit trail for the AutoFlow Marketing SEO/AEO upgrade ([Linear project](https://linear.app/helloautoflow/project/autoflow-marketing-seoaeo-c8464270cb00)). Every decision, approval, mutation (with document IDs + before/after), and validation result is recorded here.

## Environment (verified 2026-06-04)

- **Sanity:** project `koldjrka` ("AutoFlow"), org `o4qhbeErb`, dataset `production` (**public ACL**). Authenticated as brad@helloautoflow.com. **No deployed schema** — schema is local-only in `landing/sanity/schemas/`.
- **Frontend:** `landing/` — **React Router v7 (Vite)**, hybrid blog (Sanity CMS + static `lib/articles.ts`). Canonical domain `https://helloautoflow.com` (only — never `autoflow.app`). Prod deploy is Cloudflare Pages, currently `build/client` only (no runtime server → `/blog/:slug`, `/sitemap.xml`, `/robots.txt` likely 404 in prod — fixed in PR-0).
- **Content:** 8 `blogPost` docs (hub-and-spoke cluster). Audit confirmed: no `seo` object, 0 images, 0 internal links (body had no link annotation), author = string "AutoFlow", no taxonomy, no structured data.

## Decisions

- **2026-06-04** — Locked with user: full gated multi-PR build · author = single **"AutoFlow Team"** entity (no fabricated personal credentials) · SEO fields = hand-rolled `seo` object **+** `sanity-plugin-seofields` health dashboard · **server runtime intended** (PR-0 = Cloudflare SSR adapter).
- **2026-06-04** — Linear project + 8 sub-issues filed (HEL-630…HEL-637). Approved plan at `~/.claude/plans/claude-code-prompt-validated-kitten.md`.

## Changelog

### PR-1 — Sanity schema additions (HEL-631) — in progress
- Added schema objects `seo`, `blogFaq` and document types `author`, `category`, `redirect`, `siteSettings` under `landing/sanity/schemas/`.
- `blogPost`: added field groups (Content/SEO/Settings), `authorRef` (reference→author), `categories`, `dateModified`, `faqs` (blogFaq[]), `relatedPosts`, `seo` object, `coverImage.alt` (required-warning); added a **link annotation** (internal/external) + image caption to `body`; deprecated the legacy string `author` (readOnly, kept for migration/fallback).
- **Finding:** `landing/tsconfig.json` excludes `sanity/`, so `npm run typecheck` does NOT cover schema files (the only typecheck error is pre-existing/unrelated — `shared/logoDev/CompanyLogo.tsx` can't resolve `react` from landing). Schema validation must use the Sanity CLI.
- **Finding (blocker for deploy):** `sanity` (Studio core) is NOT installed in `landing/node_modules` nor hoisted at the worktree root — only `@sanity/cli` + `@sanity/icons`. The Studio has never been deployable from `landing` (consistent with "no deployed schema"; the 8 posts were seeded via `@sanity/client`). Deploying needs `sanity` added as a `landing` devDependency (gated install).
- Pending (gated — awaiting approval): add `sanity` devDep → validate via `npx sanity schema extract` → `npx sanity schemas deploy` (NEXT_PUBLIC_SANITY_PROJECT_ID=koldjrka).
