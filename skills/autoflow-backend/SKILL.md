---
name: autoflow-backend
description: >
  AutoFlow backend engineering reference — TS Express on Fly.io, the
  double-locked in-memory fallback (AUTOFLOW_ALLOW_INMEMORY), workspace
  context + Postgres RLS, repository / store pattern, middleware order
  (requireAuth → withWorkspace → requireEntitlement / requireRole), and
  how routes get wired into src/app.ts. Use when adding/modifying any
  HTTP route, repository, middleware, or backend service in this repo.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Backend Engineering Reference

The AutoFlow backend is a consolidated TypeScript Express app (P2.5 — backend
consolidation) deployed to Fly.io as `autoflow-api-{dev,staging,production}`.
The entry point is `src/index.ts` → `src/app.ts`; tests import `src/app.ts`
directly without a TCP listener. Source of truth for the operating manual is
[AGENTS.md](../../AGENTS.md).

This skill captures the non-obvious patterns. If a behavior here disagrees
with what's in code, the code wins — and the skill should be updated in the
same PR.

---

## 1. Runtime + processes

| Process | Entry | Command | Notes |
|---|---|---|---|
| API | `src/index.ts` → `src/app.ts` | `npm run dev` (Infisical) / `npm run dev:no-secrets` | Port 3000. Dashboard Vite proxies `/api` to it. |
| Worker | `src/worker.ts` | `npm run worker:dev` (Infisical) / `node dist/worker.js` | BullMQ consumer. Requires Redis. |

`ts-node` must be invoked with `--transpile-only` outside the `dev:no-secrets`
script — production deps don't include `ts-node` and a stray type-check at
startup hits TS7016 in passport typings (harmless at runtime, fatal at boot).

---

## 2. The double-locked in-memory fallback (HEL-80)

Most stores have two backends: Postgres (canonical) and a process-local
in-memory map (tests + local dev). The fallback is gated by **two** env vars:

1. `NODE_ENV` ∈ `{development, test}`
2. `AUTOFLOW_ALLOW_INMEMORY` ∈ `{"true"}` (string match — not "1" or "yes")

Both must be true. A production deploy that accidentally inherits
`NODE_ENV=development` cannot silently downgrade to in-memory because the
second gate has to be flipped too. **Never** set `AUTOFLOW_ALLOW_INMEMORY=true`
in any production environment.

```ts
// src/db/postgres.ts
export function inMemoryAllowed(): boolean {
  if (!IN_MEMORY_ALLOWED_ENVIRONMENTS.has(getRuntimeEnvironment())) return false;
  return process.env.AUTOFLOW_ALLOW_INMEMORY === "true";
}
```

Pattern every store follows:

```ts
if (isPostgresConfigured()) {
  // ... real query
  return result;
}
if (inMemoryAllowed()) {
  // ... in-memory map lookup
  return cached;
}
throw new Error("DATABASE_URL is required for <X> outside development/test");
```

The Jest harness sets `AUTOFLOW_ALLOW_INMEMORY=true` via `jest.env.cjs` so
existing tests get the fallback automatically. Local dev opts in via
`.env.local` (see `.env.local.example`).

---

## 3. Workspace context + Row-Level Security (ALT-1915)

Every customer-facing table has a `workspace_id uuid NOT NULL` column and a
`FORCE ROW LEVEL SECURITY` + tenant-isolation policy that compares
`workspace_id` to `app.current_workspace_id()` (a SQL function reading a
`SET LOCAL` session variable).

The session variable is set per-request via `withWorkspaceContext()` in
`src/middleware/workspaceContext.ts`:

```ts
import { withWorkspaceContext } from "../middleware/workspaceContext";

const result = await withWorkspaceContext(
  pool,
  { workspaceId, userId },
  async (client) => {
    // ALL queries inside this callback receive the SET LOCAL context.
    // RLS will refuse rows from other workspaces — even if the SQL forgets
    // a `WHERE workspace_id = $1` predicate.
    const { rows } = await client.query("SELECT * FROM agents");
    return rows;
  },
);
```

`SET LOCAL` scopes the value to the transaction; when the callback ends, the
session variable is cleared. **Never** call `pool.query()` directly for
tenant-scoped reads/writes — the connection may be reused and you'll either
leak across tenants or get RLS denials with no obvious cause.

Schema-side dump lives in `schema.sql`; per-table RLS migrations are in
`migrations/rls/` and `migrations/0XX_*.sql`.

---

## 4. Middleware order (matters)

The canonical pipeline for an authenticated, workspace-scoped, gated route:

```ts
import { requireAuth } from "./auth/authMiddleware";
import { withWorkspace } from "./middleware/workspaceResolver";
import { requireEntitlement } from "./middleware/requireEntitlement";
import { requireRole } from "./middleware/requireRole";
import { asyncHandler } from "./middleware/asyncHandler";

app.use(
  "/api/agents",
  requireAuth,                          // 1. Verify JWT → req.user
  withWorkspace(pool),                  // 2. Resolve req.workspace + set context
  requireEntitlement("agentCap", {      // 3. Stripe-tier gating (402 on deny)
    getCurrent: (req) => agentStore.countByWorkspace(req.workspace!.id),
  }),
  requireRole("admin"),                 // 4. workspace_members.role check
  asyncHandler(handler),                // 5. Async error → next(err)
);
```

Each step assumes the previous one ran. `requireEntitlement` will 500 if
`req.workspace` is missing because `withWorkspace` wasn't mounted first.

Async handlers **must** use `asyncHandler` (or call `next(err)` manually);
Express 4 doesn't await promise rejections in raw handlers.

---

## 5. Auth surfaces (JWT)

`requireAuth` (`src/auth/authMiddleware.ts`) accepts two token types:

- **Supabase access tokens** — verified against the project JWKS via
  `verifySupabaseTokenWithDiagnostics()`. Set `SUPABASE_URL` to the matching
  project. This is the primary flow used by the dashboard.
- **Legacy app-issued JWTs** — verified via `verifyAppUserTokenWithDiagnostics`.
  Carried by the social-auth bridge.

DASH-30 forensics: failed verifications get redacted request context
(`method`, `path`, `ip`, `cfRay`, `x-forwarded-for`) but **never** the raw
Authorization header. Don't add raw-token logging — it is a security
incident vector.

QA bypass exists via `requireAuthOrQaBypass` and `isQaBypassEnabledByName()`
for specific previews; never extend it without explicit approval.

---

## 6. Entitlements (Stripe-driven, 402-on-deny)

`src/middleware/requireEntitlement.ts` reads the workspace's plan
(`subscriptions` + `entitlements` tables) and checks the requested feature
against `PLAN_LIMITS` in `src/billing/entitlements.ts`.

Plan tiers: `explore` (free), `flow`, `automate`, `scale`. Limits include
`runsPerMonth`, `agentCap`, `integrationCap`, `byokAllowed`,
`logRetentionDays`, `approvalTierMax`.

Deny payload (HEL-22):

```json
{
  "error": "Plan limit reached: agentCap",
  "code": "entitlement_exceeded",
  "feature": "agentCap",
  "limit": 3,
  "current": 3,
  "currentTier": "flow",
  "upgradeTo": "automate"
}
```

DASH-48: the hot-path read cache misses fall back to the canonical
`entitlements` Postgres row before defaulting to "explore" — pre-DASH-48
behaviour silently downgraded paid users on every Fly restart. Don't undo
this fallback.

---

## 7. Repository / store pattern

Every domain has a `<domain>/<Domain>Store.ts` (or `Repository.ts`) module
that owns persistence. The store exposes thin async methods (`getById`,
`listByWorkspace`, `insert`, `update`, `delete`), branches on
`isPostgresConfigured()` / `inMemoryAllowed()`, and never holds business
logic.

Routes live in `<domain>/<domain>Routes.ts` and call into the store; tests
live next to them as `*.test.ts`.

```
src/agents/
  agentRoutes.ts             ← Express router (HTTP + validation)
  agentMemoryStore.ts        ← Persistence (PG + in-mem fallback)
  agentMemoryRoutes.ts
  agentMemoryRoutes.test.ts
```

When adding a new store: branch on the two gates, write both code paths,
add `*.test.ts` covering both, and never throw from in-memory mode for
errors that real Postgres wouldn't raise (e.g. unique-constraint violations
must be simulated).

---

## 8. Route registration

`src/app.ts` is the wiring sheet. New routes get imported at the top and
mounted alongside the existing groups. Keep route prefixes under `/api/<noun>`
matching the canonical glossary noun ([docs/glossary.md](../../docs/glossary.md)).
Never invent prefixes like `/api/bots` or `/api/jobs` — the noun list is
fixed.

For routes that need workspace context, mount the middleware chain at the
`app.use("/api/<noun>", ...)` line so every sub-route inherits it. Per-route
middleware is acceptable for one-offs (e.g. `requireRole("billing")` on a
single endpoint).

---

## 9. Error handling + Sentry

Sentry is initialized in `src/instrument.ts` and imported before anything
else in `src/index.ts`. The Express integration auto-captures unhandled
errors; manual reporting uses `Sentry.captureException(err, { tags: {...} })`.

`SENTRY_DSN` unset is fine for local dev — the startup line
`[sentry] SENTRY_DSN is unset` is informational and shouldn't be silenced.

---

## 10. Forbidden patterns

- ❌ `pool.query()` for tenant-scoped data — use `withWorkspaceContext()`.
- ❌ Direct provider SDK calls in handlers — go through the tier router and
  provider adapters in `src/llmConfig/`.
- ❌ Custom auth checks bypassing `requireAuth` / `requireRole`.
- ❌ Setting `AUTOFLOW_ALLOW_INMEMORY=true` in production.
- ❌ New noun prefixes — consult [`docs/glossary.md`](../../docs/glossary.md).
- ❌ Logging raw `Authorization` headers or token contents.
- ❌ Skipping `asyncHandler` on async route handlers.
