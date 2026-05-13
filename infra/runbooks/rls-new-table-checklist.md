# RLS Checklist for New Tables

**Context:** HEL-70. Any P1 table added to the schema must be added to the live RLS integration test in `src/db/rls.integration.test.ts` so isolation is continuously verified.

## When adding a new workspace-scoped table

1. **Migration file** — include all four of:
   - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`
   - `DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;`
   - `CREATE POLICY <table>_tenant_isolation ON <table> USING (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id()) WITH CHECK (...same...);`

2. **Append-only tables** (audit logs, immutable ledgers) — add RESTRICTIVE no-update/no-delete policies:
   ```sql
   CREATE POLICY <table>_no_update ON <table> AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false);
   CREATE POLICY <table>_no_delete ON <table> AS RESTRICTIVE FOR DELETE USING (false);
   ```
   Use `AS RESTRICTIVE` so the policy ANDs with permissive tenant_isolation (not ORs). See migration 025 comments.

3. **Junction/child tables** (no direct `workspace_id`) — use a subquery that joins through the parent:
   ```sql
   CREATE POLICY <table>_tenant_isolation ON <table>
   USING (EXISTS (
     SELECT 1 FROM <parent> p
     WHERE p.id = <table>.<parent_fk>
       AND (p.workspace_id IS NULL OR (app_current_workspace_id() IS NOT NULL AND p.workspace_id = app_current_workspace_id()))
   ));
   ```
   See `workflow_versions_tenant_isolation` (migration 023) and `step_results_tenant_isolation` for the pattern.

4. **Integration test** — add the table to `src/db/rls.integration.test.ts`:
   - Seed a row for workspace A and workspace B in the appropriate `it(...)` block (or the `seedAll()` helper).
   - Assert: A context sees A's row, B's context returns 0 rows for A's ID.
   - Assert: NULL context (both vars RESET) returns 0 rows.
   - If append-only: add a test that UPDATE/DELETE reject via `await expect(...).rejects.toThrow()`.
   - Add the table name to the `p1Tables` array in the FORCE RLS guard test at the bottom of the file.

5. **`pg_class` guard test** — the final `it(...)` in `rls.integration.test.ts` queries `pg_class` to verify `relrowsecurity = true` and `relforcerowsecurity = true` for every P1 table. Add your new table to the `p1Tables` and `tablesWithForceRls` arrays in that test.

## Quick reference: RLS functions

| Function | Returns | Source |
|---|---|---|
| `app_current_workspace_id()` | `uuid \| null` | `NULLIF(current_setting('app.current_workspace_id', true), '')::uuid` |
| `app_current_user_id()` | `text \| null` | `NULLIF(current_setting('app.current_user_id', true), '')` |

Both are set by `withWorkspaceContext` (`src/middleware/workspaceContext.ts`) using `SET LOCAL` inside a transaction, so they're scoped to the transaction and cannot leak across pool connections.

## Running the integration tests locally

```bash
DATABASE_URL=postgresql://autoflow:autoflow@localhost:5432/autoflow_test \
  npx jest --config jest.config.cjs --runInBand src/db/rls.integration.test.ts
```

The tests skip automatically when `DATABASE_URL` is not set.
