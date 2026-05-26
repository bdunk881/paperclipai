---
name: autoflow-frontend
description: >
  AutoFlow dashboard + landing engineering reference — React + Vite on
  Cloudflare Pages, the v2 editorial design tokens (af2-*), Tailwind config,
  React Router setup, Supabase auth wiring, the /api proxy contract, query
  client conventions, vitest + Playwright test stacks, and the v2 page
  migration story. Use when adding/modifying any dashboard page,
  component, route, or landing page.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Frontend Engineering Reference

The AutoFlow frontend is two separate Vite + React apps, both deployed to
Cloudflare Pages (Vercel was fully retired):

- `dashboard/` — the authenticated app (90+ pages). Vite + React Router DOM.
- `landing/` — the marketing site. Separate Vite project.

Both serve from Cloudflare Pages; auth + business logic flow through the
backend at `api.helloautoflow.com` (or `localhost:3000` in dev via Vite
proxy). The QA-preview-access edge handler runs as a Cloudflare Pages
Function (`dashboard/functions/api/qa-preview-access.ts`).

This skill captures the patterns that aren't obvious from package.json. Source
of truth: [AGENTS.md](../../AGENTS.md), [`docs/design/v2/`](../../docs/design/v2/).

---

## 1. Layout

```
dashboard/
  src/
    main.tsx               ← createRoot + Sentry init
    App.tsx                ← QueryClientProvider + Auth/Workspace contexts
    router.tsx             ← createBrowserRouter route tree
    af2-tokens.css         ← v2 design tokens (paper, ink, clay, sage, mustard)
    af2-components.css     ← shared v2 component styles
    auth/                  ← Supabase + legacy app-JWT bridge
    api/                   ← Typed fetch wrappers (client.ts is the base)
    components/            ← Cross-page UI (Layout, Topbar, Sidebar, modals)
    context/               ← AuthContext, WorkspaceContext, ExperienceModeContext
    pages/                 ← Route-level components (one per URL)
    hooks/                 ← Reusable hooks
    lib/queryClient.ts     ← Tanstack Query singleton
    sentry.ts              ← Sentry init for the browser
  functions/api/           ← Cloudflare Pages Function edge handlers
  vite.config.ts           ← Proxy `/api` → backend, Sentry plugin
  tailwind.config.js       ← af2-* tokens + font stacks
  playwright.config.ts     ← e2e harness
  vitest.config.ts         ← unit/component tests
```

---

## 2. Dev server + the `/api` proxy contract

Vite dev server runs on port 5173 and proxies `/api/*` to `http://localhost:3000`:

```ts
// dashboard/vite.config.ts
server: {
  port: 5173,
  proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
}
```

This means dashboard code can `fetch("/api/agents")` without origin-juggling
in dev or prod. Cloudflare Pages routes `/api/*` to the Fly backend in prod
via a Worker rule (managed by Brad). **Don't hardcode** `http://localhost:3000`
in fetch calls — go through `dashboard/src/api/baseUrl.ts:getApiBasePath()`
when you need an explicit base.

Landing site shares this convention. The dashboard and landing both default
to port 5173 — only run one at a time, or pass `--port`.

---

## 3. Auth flow (Supabase + legacy app-JWT)

`dashboard/src/auth/` owns the client side. Two token surfaces both land in
`localStorage`:

- **Supabase access tokens** — primary. Stored in `localStorage` (NOT
  `sessionStorage`) so magic-link / recovery links opened in a new tab still
  resolve. `supabaseAuth.ts` reads + persists.
- **Legacy app-JWT** — used by social-auth bridge + QA preview. Stored
  alongside via `authStorage.ts`.

Backend `requireAuth` accepts both shapes (see autoflow-backend skill §5).

`AuthContext` (`dashboard/src/context/AuthContext.tsx`) is the React-side
broadcast for the current user. `WorkspaceContext` adds the active
workspace; routes that need a workspace go through `<WorkspaceBootstrap>` in
`App.tsx` so the rest of the tree can assume `req.workspace` is set.

Env vars the dashboard needs (in `dashboard/.env.local`):

```
VITE_SUPABASE_URL=...               # autoflow-dev project URL
VITE_SUPABASE_PUBLISHABLE_KEY=...   # anon key
```

Without them, login is disabled with a configuration warning — by design.

Supabase auth-callback + recovery redirects must be allow-listed in the
Supabase Auth URL configuration: `http://localhost:5173/auth/callback` and
`http://localhost:5173/reset-password` for dev.

---

## 4. v2 design tokens (HEL-30 / HEL-31 / HEL-32)

The v2 "editorial workplace" redesign uses cream paper + deep ink, terracotta
accent, sage / mustard / plum. Tokens live in `dashboard/src/af2-tokens.css`
(lifted from `docs/design/v2/styles.css`) and are surfaced as Tailwind
classes via `tailwind.config.js`:

```jsx
<div className="bg-af2-paper text-af2-ink border border-af2-line">
  <h1 className="font-af2-serif text-display">…</h1>
  <p className="font-af2-sans text-af2-ink-3">…</p>
  <code className="font-af2-mono">…</code>
</div>
```

Color tokens (all available as `bg-af2-*`, `text-af2-*`, `border-af2-*`):
- Paper: `paper`, `paper-2`, `paper-3`, `card`
- Ink: `ink`, `ink-2`, `ink-3`, `ink-4`
- Lines: `line`, `line-2`
- Accents: `clay` (terracotta), `clay-2`, `clay-soft`, `sage`, `sage-2`,
  `mustard`, `mustard-2`, `plum`, `ink-blue`

Type stacks:
- `font-af2-serif` → Fraunces (display)
- `font-af2-sans` → Geist (UI)
- `font-af2-mono` → JetBrains Mono (code)

Display sizes: `text-display-xl`, `text-display`, `text-display-sm`.

Dark mode is **dropped** for the v2 paper aesthetic (HEL-116b). Don't add
`dark:` variants to af2 surfaces.

---

## 5. The `af2-page` migration pattern

v2 pages share a wrapper class (`.af2-page`) defined in `af2-components.css`
that sets the paper background, sets type defaults, and bounds content
width. New v2 pages adopt:

```jsx
<div className="af2-page">
  <header className="af2-page-header">…</header>
  <main>…</main>
</div>
```

The max-width clamp was dropped from `.af2-page` in HEL-todo (PR #1047) and
moved into per-page wrappers; respect that — don't reintroduce a global
max-width.

Legacy pages still use the original Electric Lab `brand-*` / `surface-*`
tokens. Don't mix them with af2-* on the same page during a partial
migration; bring the whole page over in one PR.

---

## 6. Routing

`dashboard/src/router.tsx` builds a `createBrowserRouter` tree. Each page is
a default-exported component in `dashboard/src/pages/`. Loaders + actions
follow React Router v6.4+ conventions; data-fetching loaders should call
typed wrappers from `dashboard/src/api/`, not raw `fetch`.

Route errors are caught by `<RouteErrorBoundary>` (`components/RouteErrorBoundary.tsx`);
prefer surfacing entitlement errors via `dashboard/src/api/entitlementError.ts`
so the page renders a consistent "Upgrade to ${tier}" CTA.

---

## 7. API client + Tanstack Query

`dashboard/src/api/client.ts` is the typed-fetch hub for legacy endpoints;
domain modules (`agentApi.ts`, `billingApi.ts`, `controlPlane.ts`,
`missionsApi.ts`, `memoryApi.ts`, …) hold the per-domain wrappers.

`dashboard/src/lib/queryClient.ts` exports the singleton `QueryClient`.
Components fetch with `useQuery({ queryKey: [...], queryFn })`; mutations
go through `useMutation()` and call `queryClient.invalidateQueries()` on
success.

Conventions:
- Query keys: `["agents", workspaceId]`, `["agent", agentId]`, etc. — first
  segment is the domain, subsequent are identifiers.
- Mutations call typed wrappers, not raw `fetch`.
- 402 entitlement responses throw `EntitlementError` so the boundary can
  render the upgrade CTA.

The dashboard uses `trackedFetch` to attach OTel-style request IDs for
debugging; new HTTP calls should route through it (via the typed wrappers,
not directly).

---

## 8. Testing — vitest + Playwright

Two harnesses live side-by-side:

| Harness | Config | Scope | Command |
|---|---|---|---|
| Vitest | `vitest.config.ts` | Unit + component tests (`.test.ts(x)` next to source) | `npm test` |
| Playwright | `playwright.config.ts` | e2e in `dashboard/e2e/` | `npx playwright test` |

`test-setup.ts` runs before vitest tests; `test-global-teardown.ts` after.
Don't mock `fetch` ad-hoc — extend the per-domain mock layer.

Type-check separately: `npm run type-check`. Lint: `npm run lint`.

---

## 9. Sentry

`dashboard/src/sentry.ts` is initialised at the top of `main.tsx`. The
Sentry Vite plugin in `vite.config.ts` uploads source maps in production
when `SENTRY_AUTH_TOKEN` is set (gated by `mode === "production"`).
Source maps are hidden (`build.sourcemap: "hidden"`) and `.map` files are
deleted after upload so they don't ship to the public bundle.

`Sentry.captureException(err)` works once init has run. Errors thrown inside
React get caught by Sentry's React boundary (configured in `sentry.ts`).

---

## 10. Cloudflare Pages Functions (edge)

Edge handlers live in `dashboard/functions/api/*.ts` and run on Cloudflare's
Workers runtime — not Node. They cover narrow concerns that need to run
before the SPA boots: today, `qa-preview-access.ts` exchanges a preview
token for a session cookie. Keep these tiny and stateless; don't drift
business logic into them.

---

## 11. Forbidden patterns

- ❌ Hard-coded `http://localhost:3000` in fetch — use `getApiBasePath()` or
  rely on the Vite proxy.
- ❌ Persisting Supabase session to `sessionStorage` — magic links break.
- ❌ Adding `dark:` variants to af2-* surfaces.
- ❌ Mixing legacy `brand-*` + af2-* tokens on the same page.
- ❌ New dependency on Next.js / Vercel — landing + dashboard are Vite + CF
  Pages.
- ❌ Raw `fetch` for API calls — go through the typed wrappers so
  `EntitlementError`, request tracking, and auth headers all work.
