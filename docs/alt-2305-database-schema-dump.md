# ALT-2305 Database Schema Dump

Generated on 2026-05-04 from a clean local database created for this task (`alt2305_schema_dump`) after applying `migrations/001` through `migrations/020`, then running:

```bash
pg_dump --schema-only postgresql://paperclip:paperclip@localhost:5432/alt2305_schema_dump > schema.sql
```

`schema.sql` is attached in-repo at the repository root for Phase 1a review. This is a migration-head draft, not a verified production dump, because this heartbeat did not have a production Postgres connection string.

## Schema Summary

- Schemas: `public`, `observability`
- Tables: 66
- Functions: 42
- User-defined functions: `public.app_current_workspace_id()`, `public.app_current_user_id()`, `public.enforce_email_send_workspace_match()`, `observability.ensure_event_partitions(...)`, `observability.refresh_rollups(...)`, `observability.apply_retention(...)`
- Trigger objects: 1 (`public.trg_email_sends_workspace_match`)
- Extensions in dump: `pgcrypto`, `plpgsql`
- RLS-enabled tables: 20
- FORCE RLS tables: 11
- Policies: 24

## Supabase Compatibility Notes

Tables that require superuser context:

- None of the table definitions are inherently superuser-only.
- Restore-time ownership statements (`ALTER ... OWNER TO paperclip`) appear throughout `schema.sql`. These will need to be stripped or mapped to the restore role in Supabase if the target role is not `paperclip`.
- `CREATE EXTENSION IF NOT EXISTS pgcrypto` requires a role allowed to install `pgcrypto` in the target project.

Functions that may need adjustment for Supabase's role model:

- `observability.ensure_event_partitions(...)` executes dynamic `CREATE TABLE ... PARTITION OF ...` statements. In Supabase this should run under a privileged migration or scheduled service-role path, not an untrusted app role.
- `observability.apply_retention(...)` executes dynamic `DROP TABLE IF EXISTS ...` against observability partitions and likewise assumes elevated ownership over those partitions.
- `public.app_current_workspace_id()` and `public.app_current_user_id()` depend on session settings (`app.current_workspace_id`, `app.current_user_id`). Phase 1a must preserve that session-variable contract or translate the RLS predicates to Supabase JWT claim helpers.
- No `SECURITY DEFINER` functions are present in the draft dump.

Extension requirements:

- Required by the migration-head draft: `pgcrypto`
- Built-in language present: `plpgsql`
- Not present in the migration-head draft: `pgvector`

## Environment Drift Observed

The existing local `paperclip` database in this workspace is not a safe proxy for production:

- It contains extra schemas `alt1472_verify` and `drizzle` that are not created by the tracked migration set.
- It contains an extra installed extension, `pg_trgm`.
- Its schema shape is much larger than the clean migration-applied database.

That drift is why the committed `schema.sql` was regenerated from a fresh database built from migrations instead of the already-running local database.

## Remaining Blocker

The final deliverable for ALT-2305 still needs one follow-up action:

- Re-run `pg_dump --schema-only` against the real production Postgres instance, compare it against this draft, and replace `schema.sql` if drift exists.
