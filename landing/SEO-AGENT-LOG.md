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
- **2026-06-04** — Approved (gated): install + validate + deploy. Added devDeps `sanity@5.30.0` + `styled-components@^6.1.15` (Studio peers; `sanity`/`@sanity/cli` are NOT version-locked — cli is 6.6.0, studio is 5.x). React 19 peer satisfied.
- **Validated:** `npx sanity schemas validate` → **0 errors, 0 warnings**. `npm run build` → **pass** (build also confirms PR-0: only /, /blog, /demo, /signup, /privacy, /terms prerender; `/blog/:slug`, `/sitemap.xml`, `/robots.txt` absent; `build/server/index.js` built but CI deploys `build/client` only).
- **BLOCKED — cloud schema deploy:** `npx sanity schemas deploy` → `You must login first - run "sanity login"`. No `SANITY_AUTH_TOKEN` in env. Not deploying via a fished Infisical token (secret hygiene). Options surfaced to Brad: `sanity login` / provide deploy token / authorize MCP `deploy_schema` fallback. NOTE: the cloud manifest deploy is decoupled from the MCP-based content work (PR-2 writes are schemaless) — it powers MCP `get_schema` + hosted Studio + visual editing.
- **DEPLOYED (2026-06-04):** Brad ran `sanity login`. `npx sanity schemas deploy --workspace autoflow-landing` → `Deployed 1/1 schemas` (`_.schemas.autoflow-landing`, koldjrka/production). Verified via MCP `get_schema`: blogPost shows all 13 fields (authorRef, categories, dateModified, faqs, seo, + body link annotation). **PR-1 complete** — PR [#1337](https://github.com/bdunk881/paperclipai/pull/1337) in review.

### PR-2 — Backfill author / categories / siteSettings (HEL-632) — DONE
- Approved "direct publish" (backfill is invisible to visitors until PR-3 reads the fields). Created via MCP then published: `author` **"AutoFlow"** (team bio; `links`/sameAs empty pending socials), 4 `category` docs (Comparisons / Guides / Tutorials / Trends & Insights), `siteSettings` singleton (orgName + default meta description; **`products` left empty — pricing is Supabase-owned** per Brad, so no price markup).
- Patched + published all 8 posts: `authorRef` → AutoFlow + one category each (4 vs-* comparisons + best-tools listicle → Comparisons; pillar → Guides; invoice tutorial → Tutorials; future-of-no-code → Trends & Insights). Legacy `author` string retained.
- Gotchas: (1) the auto-mode classifier blocks patching live published docs until the user approves; (2) references must point to **published** ids, so new docs were published *before* patching the posts; (3) `create_documents_from_json` ignores a supplied `_id` and assigns random ids. Author id `92381cf5-029f-4b71-b876-54974a644f33`; categories Comparisons `9cab6019…`, Guides `ec70e312…`, Tutorials `2c3368ef…`, Trends `931691f6…`; siteSettings `8506f4c3…`.
- Verified (published perspective): 8/8 posts authorRef=AutoFlow + 1 category; 1 author, 4 categories, 1 siteSettings.
- **Flagged for PR-6 (content quality):** imported bodies render literal markdown artifacts (`**bold**`, `###`, code fences, `|tables|`) as text; internal "Related Reading" links use stale `/articles/<slug>` (routes are `/blog/<slug>`) and a non-existent `/articles/5-workflows-smbs`; CTAs point to **`autoflow.ai`** (wrong — canonical is `helloautoflow.com` only).
