---
name: autoflow-supabase-rls
description: >
  AutoFlow Supabase + Postgres Row-Level Security reference — how
  workspace_id flows from JWT → session variable → RLS policy, the
  app_current_workspace_id() SQL function, the canonical
  withWorkspaceContext() pattern, RLS migration conventions in
  migrations/rls/, the FORCE ROW LEVEL SECURITY default for tenant
  tables, and what to do when an RLS denial surfaces. Use whenever
  you're writing a migration, a tenant-scoped query, or touching
  src/auth/.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Supabase + RLS Reference

AutoFlow's tenancy boundary is the `workspace_id` column. Every
customer-facing table has one, and Postgres Row-Level Security forces the
predicate at the database layer — even if a handler forgets a
`WHERE workspace_id = $1`, the rows are filtered to the caller's workspace.

The mechanism: per-request, a session variable `app.current_workspace_id`
is set via `SET LOCAL` inside a transaction. RLS policies call
`app_current_workspace_id()` (a SQL function reading the variable) and
compare to `workspace_id`. This is ALT-1915 / HEL-todo and is non-negotiable.

---

## 1. The flow end-to-end

```
JWT (Supabase or app-issued)
  → requireAuth verifies + decodes → req.user.id
  → withWorkspace(pool) resolves workspace + role → req.workspace
  → handler calls withWorkspaceContext(pool, {workspaceId, userId}, fn)
    → pool.connect()
    → BEGIN
    → SELECT set_config('app.current_workspace_id', $1, true)
    → SELECT set_config('app.current_user_id', $1, true)
    → fn(client)                 ← all queries here see RLS-filtered rows
    → COMMIT (or ROLLBACK on throw)
    → client.release()
```

`SET LOCAL` scopes the variable to the transaction; when the transaction
ends the variable is cleared. This is what prevents leakage when pg's
connection pool reuses a connection across requests.

---

## 2. `withWorkspaceContext()` is the only correct way to query tenant data

`src/middleware/workspaceContext.ts`:

```ts
import { withWorkspaceContext } from "../middleware/workspaceContext";

const agents = await withWorkspaceContext(
  pool,
  { workspaceId: req.workspace!.id, userId: req.user!.id },
  async (client) => {
    // RLS is in effect. This query returns ONLY the caller's agents.
    const { rows } = await client.query("SELECT * FROM agents");
    return rows;
  },
);
```

The lower-level primitives (`beginWorkspaceTransaction`,
`commitWorkspaceTransaction`, `rollbackWorkspaceTransaction`) exist for
multi-step flows where you want explicit commit/rollback control.

**Never** call `pool.query()` directly for a tenant-scoped read or write.
The connection may be reused and either:
- Return rows from another tenant (no context set), or
- Get an RLS denial with no useful error context.

---

## 3. The `app_current_workspace_id()` SQL function

```sql
CREATE FUNCTION public.app_current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
  SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
$$;
```

The `true` second arg to `current_setting` makes it return `NULL` instead of
raising when the variable is unset (e.g. on a connection that never went
through `withWorkspaceContext`).

Policies typically look like:

```sql
CREATE POLICY agents_tenant_isolation ON agents
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );
```

Both `USING` (read) and `WITH CHECK` (write) are set — a row inserted with
a `workspace_id` that doesn't match the session variable is rejected, so a
bug in a handler can't slip a foreign-workspace row in.

---

## 4. New table → RLS migration template

Every new tenant-scoped table needs the same trio of statements:

```sql
-- migrations/0XX_my_new_table.sql
CREATE TABLE my_new_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- ... domain columns ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX my_new_table_workspace_id_idx ON my_new_table(workspace_id);

ALTER TABLE my_new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_new_table FORCE ROW LEVEL SECURITY;

CREATE POLICY my_new_table_tenant_isolation ON my_new_table
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );
```

`FORCE ROW LEVEL SECURITY` is critical — without it, the table owner
bypasses RLS. With it, even the owner role is gated, so a misconfigured
admin tool or a forgotten `set_config` call surfaces as a denial rather
than a silent cross-tenant read.

For tables with cross-workspace constraints (e.g. an FK that must match
the parent's `workspace_id`), add a trigger like the `email_sends`
workspace-match enforcement in `schema.sql:251` so the integrity isn't
relying on the handler doing the right thing.

---

## 5. Append-only tables (audit_log)

Some tables enforce append-only semantics on top of tenant isolation:

```sql
CREATE POLICY audit_log_no_delete ON audit_log AS RESTRICTIVE FOR DELETE USING (false);
CREATE POLICY audit_log_no_update ON audit_log AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false);
```

`RESTRICTIVE` policies combine with `AND` against the permissive isolation
policy; together they mean "you can only see your workspace's rows AND
you can never delete or update any row". Use this for any audit /
spend-entry / ledger table.

---

## 6. Bypassing RLS (carefully)

There are legitimate places where RLS must be bypassed:

- **Migrations** — run as the owner role; RLS is implicit-bypass for
  table-owner unless `FORCE` is set, so prefer migrations that work even
  with `FORCE` enabled (set the variable manually if needed).
- **Cross-workspace operations** — onboarding flows that create a workspace
  before the user has one. Pattern: use a privileged role + an audited
  service-account function, never bypass via a forgotten `set_config`.
- **Webhooks** — Stripe / connector webhooks arrive before the request has
  a workspace context. The handler resolves the workspace from the event
  payload, then opens `withWorkspaceContext` for the rest of the work.

Never use `SUPABASE_SERVICE_ROLE_KEY` from the dashboard. That key has
god-mode access and belongs only in the backend (and only in the narrow
flows that need it).

---

## 7. Supabase Auth specifics

The dashboard uses Supabase Auth; the backend verifies the access token
via Supabase's JWKS (`src/auth/supabaseAuth.ts:verifySupabaseTokenWithDiagnostics`).
Configuration:

- `SUPABASE_URL` — same project for backend (JWT verification) and
  dashboard (sign-in).
- `SUPABASE_PUBLISHABLE_KEY` — dashboard uses this (anon role).
- `SUPABASE_SERVICE_ROLE_KEY` — backend-only, used by `src/auth/`
  helpers that need elevated reads on `auth.users`.
- Auth callback / recovery URLs must be allow-listed in the Supabase Auth
  URL config: `http://localhost:5173/auth/callback`,
  `http://localhost:5173/reset-password` for dev; production hostnames
  for prod.

PKCE: Supabase auth state goes in `localStorage` (not `sessionStorage`)
so magic-link and recovery emails opened in a new tab still complete.

---

## 8. Common RLS denial debugging

Symptom: a query returns 0 rows when you expect rows.

1. Confirm `req.workspace` is set (the middleware ran).
2. Confirm you used `withWorkspaceContext(pool, {workspaceId, userId}, ...)`
   not `pool.query()`.
3. Inspect the connection's variable inside the callback:
   ```ts
   await client.query("SHOW app.current_workspace_id");
   ```
4. Check whether the row's `workspace_id` actually matches — common bug
   is an FK pointing to a row in a different workspace.

Symptom: `new row violates row-level security policy for table "X"`.

1. The `WITH CHECK` clause is rejecting the insert. Usually the row's
   `workspace_id` doesn't match `app_current_workspace_id()`.
2. Check whether you're passing `workspace_id` explicitly, vs relying on
   a default that's NULL. Most tenant tables require the column be set
   explicitly.

---

## 9. Schema / migration conventions

- Migrations live in `migrations/` (numbered) and `migrations/rls/`
  (helpers). `scripts/run-migrations.sh` applies them in order.
- The current canonical dump is `schema.sql` (60+ tables). Update it
  alongside a new migration so `pg_dump` diffs stay clean.
- Naming: `0XX_<verb>_<noun>.sql` (e.g. `065_app_api_role.sql`,
  `062_mission_scoped_memory.sql`).
- New canonical nouns require a glossary update in the same PR — see
  the autoflow-product-model skill.

---

## 10. Forbidden patterns

- ❌ `pool.query()` for tenant-scoped data — use `withWorkspaceContext()`.
- ❌ Bypassing RLS via `SET row_security = off` in a handler.
- ❌ Using `SUPABASE_SERVICE_ROLE_KEY` from the dashboard.
- ❌ Creating a tenant table without `FORCE ROW LEVEL SECURITY` + the
  isolation policy.
- ❌ Persisting Supabase session to `sessionStorage`.
- ❌ FKs across workspace boundaries without an enforcing trigger.
- ❌ Logging the JWT bearer token contents.
