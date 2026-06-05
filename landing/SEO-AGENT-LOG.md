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

### PR-1 — Sanity schema additions (HEL-631) — DONE (merged #1337)
- Added schema objects `seo`, `blogFaq` and document types `author`, `category`, `redirect`, `siteSettings` under `landing/sanity/schemas/`.
- `blogPost`: added field groups (Content/SEO/Settings), `authorRef` (reference→author), `categories`, `dateModified`, `faqs` (blogFaq[]), `relatedPosts`, `seo` object, `coverImage.alt` (required-warning); added a **link annotation** (internal/external) + image caption to `body`; deprecated the legacy string `author` (readOnly, kept for migration/fallback).
- **Finding:** `landing/tsconfig.json` excludes `sanity/`, so `npm run typecheck` does NOT cover schema files (the only typecheck error is pre-existing/unrelated — `shared/logoDev/CompanyLogo.tsx` can't resolve `react` from landing). Schema validation must use the Sanity CLI.
- **Finding (blocker for deploy):** `sanity` (Studio core) is NOT installed in `landing/node_modules` nor hoisted at the worktree root — only `@sanity/cli` + `@sanity/icons`. The Studio has never been deployable from `landing` (consistent with "no deployed schema"; the 8 posts were seeded via `@sanity/client`). Deploying needs `sanity` added as a `landing` devDependency (gated install).
- **2026-06-04** — Approved (gated): install + validate + deploy. Added devDeps `sanity@5.30.0` + `styled-components@^6.1.15` (Studio peers; `sanity`/`@sanity/cli` are NOT version-locked — cli is 6.6.0, studio is 5.x). React 19 peer satisfied.
- **Validated:** `npx sanity schemas validate` → **0 errors, 0 warnings**. `npm run build` → **pass** (build also confirms PR-0: only /, /blog, /demo, /signup, /privacy, /terms prerender; `/blog/:slug`, `/sitemap.xml`, `/robots.txt` absent; `build/server/index.js` built but CI deploys `build/client` only).
- **BLOCKED — cloud schema deploy:** `npx sanity schemas deploy` → `You must login first - run "sanity login"`. No `SANITY_AUTH_TOKEN` in env. Not deploying via a fished Infisical token (secret hygiene). Options surfaced to Brad: `sanity login` / provide deploy token / authorize MCP `deploy_schema` fallback. NOTE: the cloud manifest deploy is decoupled from the MCP-based content work (PR-2 writes are schemaless) — it powers MCP `get_schema` + hosted Studio + visual editing.
- **DEPLOYED (2026-06-04):** Brad ran `sanity login`; `npx sanity schemas deploy --workspace autoflow-landing` → `Deployed 1/1 schemas` (`_.schemas.autoflow-landing`, koldjrka/production). Verified via MCP `get_schema` (blogPost shows all 13 fields). PR [#1337](https://github.com/bdunk881/paperclipai/pull/1337) merged to dev (squash `be7b1b5a`).

### PR-2 — Backfill author / categories / siteSettings (HEL-632) — DONE
- Created via MCP + published (Brad approved direct publish; invisible to visitors until PR-3 reads the fields): `author` **"AutoFlow"** (team bio; `links`/sameAs empty pending socials), 4 `category` docs, `siteSettings` singleton (orgName + default meta description; **`products` empty — pricing is Supabase-owned**).
- Patched + published all 8 posts: `authorRef` → AutoFlow `92381cf5-…` + one category each (vs-*×4 + best-tools → Comparisons; pillar → Guides; invoice → Tutorials; future-of-no-code → Trends). Legacy `author` string retained. Category ids: Comparisons `9cab6019…`, Guides `ec70e312…`, Tutorials `2c3368ef…`, Trends `931691f6…`; siteSettings `8506f4c3…`.
- Gotchas: auto-mode classifier blocks live-published-doc writes until the user approves; references need **published** ids (publish new docs before patching); `create_documents_from_json` ignores a supplied `_id`.
- Verified (published perspective): 8/8 posts authorRef=AutoFlow + 1 category; 1 author, 4 categories, 1 siteSettings.
- **Flagged for PR-6:** imported bodies have literal markdown artifacts (`**`, `###`, code fences, `|tables|`), stale `/articles/<slug>` internal links (routes are `/blog/<slug>`), and wrong-domain `autoflow.ai` CTAs (canonical is helloautoflow.com only).

### PR-3 — Query layer + apiVersion (HEL-633) — in progress
- `landing/lib/sanity.ts`: `apiVersion` 2024-01-01 → **2026-02-01**. `getBlogPosts` author → `coalesce(authorRef->name, author)` (stays a string — listing unchanged). `getBlogPost` rewritten: author object `coalesce(authorRef->{…}, {"name":author})`, `dateModified` coalesce, `categories[]->`, `faqs[]{question,answer}`, smart-default `seo{}` (metaTitle→title, metaDescription→excerpt, ogImage→coverImage, noIndex), and body `markDefs[]{…, reference->{slug}}` for internal links. Added `getSiteSettings` / `getEnabledRedirects` / `getBlogSitemapEntries` + TS interfaces.
- `app/blog/[slug]/page.tsx`: byline now reads `cmsPost.author.name` (author is an object).
- Verified: typecheck clean (only the pre-existing `logoDev` baseline error); `npm run build` + `npm run lint` pass; live MCP smoke-test of the projection returns author `{name, role}`, the category, and coalesced `seo`/`dateModified`.

### PR-4 — Frontend metadata + JSON-LD entity graph (HEL-634) — in progress
- New `landing/lib/structuredData.ts`: `siteGraphLd()` (Organization + WebSite + SoftwareApplication, `@id`-linked; **SoftwareApplication has no offers — pricing is Supabase-owned**), `blogPostingLd` / `breadcrumbLd` / `faqPageLd`, `SITE_URL` const (`helloautoflow.com` — canonical always points at prod, even from preview deploys), `serializeLd` (escapes `<`).
- `app/root.tsx` Layout: sitewide JSON-LD `<script>` on **every** page. **RR7 gotcha:** leaf-route `meta()` REPLACES ancestor meta (no merge), so the sitewide graph must render from the Layout, not root `meta()`.
- `app/blog/[slug]/page.tsx`: loader computes `canonical` + `ogImageUrl`; `meta()` emits canonical link, OG/Twitter (`summary_large_image`), `robots noindex` when `seo.noIndex`, and `script:ld+json` = BlogPosting + BreadcrumbList + (FAQPage when faqs present). Added a `link` mark renderer (internal `<Link>` vs external `<a rel=noopener>`), a `coverImage` hero, and image captions.
- **Verified end-to-end:** typecheck (only the logoDev baseline) + build + lint pass; prerendered homepage carries the sitewide graph; **runtime SSR curl of `/blog/autoflow-vs-zapier`** shows `<title>`, `<link rel=canonical href=https://helloautoflow.com/...>`, og:image (og.svg fallback), twitter summary_large_image, and JSON-LD with BlogPosting + BreadcrumbList (3 ListItem) + Person ("AutoFlow") + WebPage **plus** the sitewide Organization/WebSite/SoftwareApplication.

### PR-5 — Sitemap / robots polish (HEL-635) — in progress
- `app/sitemap.ts`: blog URLs now come from `getBlogSitemapEntries()` (per-post `lastmod` = coalesce(dateModified,_updatedAt); excludes `seo.noIndex`); static fallback articles use their `publishedAt`; CMS slugs win on overlap. Per-entry `<lastmod>` (was a single `now` for every URL).
- `app/robots.ts`: added explicit `Allow: /` for AI/answer-engine crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended) alongside `User-agent: *`; kept Disallow /api/ /studio/ + the sitemap reference.
- Verified (Node `npm run start` + curl): `/sitemap.xml` 200 with 8 blog urls + per-post lastmod (autoflow-vs-zapier → 2026-06-05T02:18:48Z, distinct from the static `now`); `/robots.txt` 200 with the AI-crawler allows. typecheck clean (only logoDev baseline — the transient `lib/sanity.ts` literal-narrow error was a stray PR-0 `worker-configuration.d.ts` left on disk, gone after `rm`); build + lint pass.
