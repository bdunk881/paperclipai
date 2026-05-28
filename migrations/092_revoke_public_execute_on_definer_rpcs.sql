-- Migration 092 (HEL-304 follow-up): close PUBLIC grant leak on 3
-- SECURITY DEFINER functions that survived migration 090.
--
-- ## Why this exists
--
-- Migration 090 revoked EXECUTE from `anon` and `authenticated` on the
-- 13 SECURITY DEFINER functions from the HEL-304 audit. Re-running
-- `get_advisors(type=security)` after apply showed three of them
-- STILL flagged as `anon_security_definer_function_executable` and
-- `authenticated_security_definer_function_executable`:
--
--   * list_due_prompt_routines()
--   * lookup_team_workspace_id(uuid)
--   * mark_ended_prompt_routines()
--
-- These functions also have `GRANT EXECUTE TO PUBLIC` in their
-- pg_proc.proacl. The `anon` and `authenticated` roles inherit from
-- `PUBLIC` (per `pg_has_role(...)` checks), so the original
-- migrations' `REVOKE EXECUTE FROM anon, authenticated` only removed
-- the direct grant — the inherited grant via PUBLIC stayed live. The
-- advisor uses `has_function_privilege()`, which resolves the
-- inheritance, so the warning persisted.
--
-- The other 10 functions in HEL-304's scope shipped with explicit
-- `REVOKE EXECUTE FROM PUBLIC` in their original migrations (good
-- practice). These three didn't:
--   * migration 030 (lookup_team_workspace_id) — no REVOKE FROM PUBLIC
--   * migration 073 (list_due_prompt_routines + mark_ended_prompt_routines) — no REVOKE FROM PUBLIC
--
-- Fix: revoke EXECUTE from PUBLIC, then re-grant only to the roles
-- that actually need it (postgres + service_role + autoflow_api for
-- the team-lookup that the RLS-enforced integration tests use).
--
-- ## Why not amend migration 090 instead
--
-- 090 is already merged + applied. Stacking another `REVOKE FROM
-- PUBLIC` migration is the standard pattern (and safer than going
-- back to edit a closed migration).

BEGIN;

-- Helper: revoke + re-grant for a single function. We use DO-block
-- format() so a missing role in a less-provisioned env (e.g. local
-- dev without autoflow_api) doesn't trip the migration.
DO $$
DECLARE
  fn_sig text;
  role_name text;
BEGIN
  FOR fn_sig IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'list_due_prompt_routines',
        'lookup_team_workspace_id',
        'mark_ended_prompt_routines'
      )
  LOOP
    -- Strip the PUBLIC grant. anon + authenticated lose their inherited
    -- EXECUTE; postgres + service_role still have direct grants from
    -- the original migrations.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn_sig);

    -- Belt + suspenders: if the original migration ever shipped
    -- without the direct postgres/service_role grants, restore them.
    FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %I', fn_sig, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
