-- Migration 089 (HEL-302): revoke SELECT from anon + authenticated on
-- every public.* table the API doesn't intentionally expose via
-- PostgREST/GraphQL.
--
-- ## Background
--
-- Supabase grants `SELECT, INSERT, UPDATE, DELETE` to the `anon` and
-- `authenticated` roles on every public.* table by default (via
-- `ALTER DEFAULT PRIVILEGES`). These roles are what PostgREST + the
-- pg_graphql extension use to evaluate REST + GraphQL queries from
-- Supabase's hosted endpoints.
--
-- Our AutoFlow API does NOT use those endpoints — every read/write
-- runs through Express + `pg` directly, authenticated as the
-- `postgres` role via `DATABASE_URL`. PostgREST is reachable but
-- nothing in our codebase calls it (verified by greps for `.from(`
-- and `/rest/v1/` in dashboard + admin + src). The Supabase JS
-- clients we use only touch `auth.*` for sign-in flows.
--
-- HEL-273 + HEL-298 enabled FORCE RLS on most user/workspace tables,
-- so a probe via the anon/authenticated roles already returns zero
-- rows — but Supabase's security advisor still flags every table as
-- `anon_role_can_select_a_table` / `authenticated_role_can_select_a_table`
-- because the GRANT itself leaks the table's existence + column
-- shape via the GraphQL schema introspection.
--
-- ## What this revokes
--
-- All `public.*` tables EXCEPT `public_status_events`. The status page
-- (`landing/status` served by `src/landing/publicStatusService.ts`)
-- reads from this table via the backend API, but `public_status_events`
-- is the documented "marketing surface" exception from the HEL-302
-- ticket and we leave its grant alone in case Supabase Realtime / a
-- future component-status widget wants to subscribe directly.
--
-- ## What this does NOT do
--
-- * Default privileges (`ALTER DEFAULT PRIVILEGES IN SCHEMA public …`)
--   stay as-is, so future `CREATE TABLE public.foo` will re-grant
--   SELECT to anon/authenticated. Fixing that requires identifying
--   which role/schema owns the defaults (Supabase manages some) and
--   is out of scope here — tracked in the HEL-302 acceptance comment.
-- * Tables with RLS *disabled* (admin_agent_*, knowledge_bases, etc.)
--   get the same revoke, which means PostgREST returns 404 on them
--   for any non-superuser role. They were already unreachable in
--   practice (RLS-disabled tables are normally bypass-only) but if
--   any of those tables grows a legitimate PostgREST consumer the
--   grant will have to be re-issued explicitly.
-- * INSERT / UPDATE / DELETE grants are untouched. RLS still guards
--   writes; the API uses a separate role with its own grants.

BEGIN;

-- Iterate every table in the public schema and revoke SELECT from
-- anon + authenticated. Allowlist-driven so the one legitimate
-- public-marketing surface keeps its grant.
DO $$
DECLARE
  target text;
  allowlist text[] := ARRAY[
    -- HEL-302 scope explicitly preserves public-marketing surfaces.
    -- `public_status_events` feeds the public status page at
    -- /status; keeping the grant lets Supabase Realtime broadcast
    -- component-status transitions without proxying through the API.
    'public_status_events'
  ];
BEGIN
  FOR target IN
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name <> ALL (allowlist)
    ORDER BY table_name
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', target);
  END LOOP;
END
$$;

COMMIT;
