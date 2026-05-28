-- Migration 090 (HEL-304): tighten SECURITY DEFINER RPC grants, enable RLS
-- on public_status_events, and add workspace-isolation policy on
-- agent_turn_trace_events.
--
-- ## Background
--
-- Supabase's `get_advisors(type=security)` surfaced three warning classes
-- after the migration 089 SELECT-grant revoke:
--
--   1. anon_security_definer_function_executable /
--      authenticated_security_definer_function_executable (HIGH)
--      13 SECURITY DEFINER functions in public.* are still executable by
--      the `anon` and `authenticated` roles via PostgREST RPC despite
--      having REVOKE FROM PUBLIC in their original migrations. Supabase's
--      default-privilege chain re-grants EXECUTE to these concrete roles
--      after CREATE OR REPLACE, so an explicit REVOKE per role is needed.
--
--   2. rls_disabled_in_public (ERROR)
--      `public_status_events` has RLS disabled. It was allowlisted in
--      migration 089 (the public status page needs anon SELECT) but that
--      allowlist only preserved the grant — enabling RLS with an explicit
--      permissive-read policy achieves the same result and removes the
--      `rls_disabled_in_public` warning.
--
--   3. rls_enabled_no_policy (WARNING)
--      `agent_turn_trace_events` had RLS enabled by migration 056 but
--      no policies were ever created, making it effectively deny-all for
--      non-superuser sessions. Add workspace-isolation + admin-read policies
--      to match the rest of the agent_* tables (migration 087 pattern).

BEGIN;

-- ==========================================================================
-- 1. Revoke EXECUTE on SECURITY DEFINER RPCs from anon / authenticated
-- ==========================================================================
--
-- Pattern: dynamically iterate all matching functions in pg_proc so we
-- handle any overloaded variants and avoid hard-coding argument lists.
-- Roles are confirmed to exist before REVOKE to avoid errors in local
-- dev databases that don't have them.
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
        'admin_list_workspaces_for_user',
        'admin_lookup_user_by_email',
        'admin_lookup_user_by_id',
        'admin_recent_activity_for_user',
        'list_agent_executions_for_user',
        'list_agent_heartbeats_for_user',
        'list_agent_tasks_for_user',
        'list_agents_for_user',
        'list_companies_for_user',
        'list_due_prompt_routines',
        'list_teams_for_user',
        'lookup_team_workspace_id',
        'mark_ended_prompt_routines'
      )
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn_sig, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ==========================================================================
-- 2. Enable RLS on public_status_events + policies
-- ==========================================================================
--
-- The public status page (landing/status, served by
-- src/landing/publicStatusService.ts) reads this table. The SELECT grant
-- for anon (preserved in migration 089) is kept; the permissive read policy
-- below allows it through RLS without narrowing by user or workspace.
--
-- Writes come exclusively from the backend (postgres role, bypasses RLS)
-- and the platform-admin console. The admin-write policy below ensures that
-- even if the INSERT/UPDATE/DELETE grants were ever re-extended to anon or
-- authenticated, only platform admins could act on them.
--
-- Rollback:
--   ALTER TABLE public.public_status_events DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS public_status_events_anon_read ON public.public_status_events;
--   DROP POLICY IF EXISTS public_status_events_admin_write ON public.public_status_events;

ALTER TABLE public.public_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_status_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_status_events_anon_read ON public.public_status_events;
CREATE POLICY public_status_events_anon_read ON public.public_status_events
  AS PERMISSIVE FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS public_status_events_admin_write ON public.public_status_events;
CREATE POLICY public_status_events_admin_write ON public.public_status_events
  AS PERMISSIVE FOR ALL
  TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- ==========================================================================
-- 3. Workspace-isolation policy on agent_turn_trace_events
-- ==========================================================================
--
-- Migration 056 enabled RLS but wrote no policies. This mirrors the shape
-- used on agent_memory_events / agent_heartbeat_logs (migration 087, Cat B).
--
-- Rollback:
--   DROP POLICY IF EXISTS agent_turn_trace_events_workspace_isolation ON public.agent_turn_trace_events;
--   DROP POLICY IF EXISTS agent_turn_trace_events_admin_read ON public.agent_turn_trace_events;

ALTER TABLE public.agent_turn_trace_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_turn_trace_events_workspace_isolation ON public.agent_turn_trace_events;
CREATE POLICY agent_turn_trace_events_workspace_isolation ON public.agent_turn_trace_events
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id::text = app_current_workspace_id()::text
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id::text = app_current_workspace_id()::text
  );

DROP POLICY IF EXISTS agent_turn_trace_events_admin_read ON public.agent_turn_trace_events;
CREATE POLICY agent_turn_trace_events_admin_read ON public.agent_turn_trace_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

COMMIT;
