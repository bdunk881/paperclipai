-- Migration 046: list_agent_tasks_for_user helper (DASH-64.1 follow-up,
-- addresses Codex review on PR #901).
--
-- Context:
--   controlPlaneStore.listTasks(userId) — without a workspaceId — is
--   called by /api/observability, report-routes board-memos, and HITL
--   company summaries. These surfaces show the user's activity across
--   every workspace they're a member of, not a single workspace.
--
-- The naive fix in DASH-64.1 used `pool.query("SELECT ... FROM
-- agent_tasks WHERE user_id = $1")` without setting an
-- `app.current_workspace_id` session var. agent_tasks has FORCE RLS
-- requiring that var, so the raw SELECT returned zero rows in
-- production — Codex caught it.
--
-- This helper is SECURITY DEFINER (same pattern as migration 030's
-- `lookup_team_workspace_id`) and encodes the access semantics in
-- its body: rows where user_id = caller-supplied user, regardless of
-- workspace context. The function body is the ONLY place that
-- bypasses RLS; downstream callers still get workspace-isolated reads
-- when they pass a workspaceId.
--
-- Returns rows as the agent_tasks table type so callers can SELECT *
-- from it without re-declaring the schema.

BEGIN;

CREATE OR REPLACE FUNCTION list_agent_tasks_for_user(p_user_id text)
RETURNS SETOF agent_tasks
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM agent_tasks WHERE user_id = p_user_id ORDER BY created_at ASC
$$;

-- Lock the search_path so the SECURITY DEFINER body can't be hijacked
-- by a malicious schema in front of public.
ALTER FUNCTION list_agent_tasks_for_user(text) SET search_path = public, pg_catalog;

-- DASH-64.1 hotfix (Codex review on PR #901): without explicit
-- privilege management, any SQL/RPC-capable client (Supabase's anon /
-- authenticated roles) could call this function with another user's
-- id and bypass agent_tasks RLS to read cross-workspace tasks for that
-- victim. Functions in `public` default to EXECUTE granted to PUBLIC.
--
-- Lock it down: revoke the default grant, then explicitly grant only
-- to the service-role-equivalent the backend uses. The backend
-- connection (the autoflow Postgres role / Supabase service_role)
-- already has cross-workspace read authority through normal RLS-
-- bypass mechanisms; this just removes the function as an alternative
-- entry point for client roles.
REVOKE EXECUTE ON FUNCTION list_agent_tasks_for_user(text) FROM PUBLIC;

-- The exact role names depend on the environment:
--   - Supabase production: `service_role` (used by server-side fetches)
--   - Self-hosted dev: the user the backend connects as
-- We grant to both authenticated server-only roles. The `DO` block
-- silently skips a role that doesn't exist in the target environment
-- (Supabase has both `service_role` and `postgres`; dev has just
-- whoever owns the schema).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_agent_tasks_for_user(text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_agent_tasks_for_user(text) TO postgres';
  END IF;
END $$;

COMMENT ON FUNCTION list_agent_tasks_for_user(text) IS
  'DASH-64.1: SECURITY DEFINER helper. Returns all agent_tasks rows owned by the given user across every workspace they belong to. Used by cross-workspace observability/reporting surfaces that have a userId but no resolved workspaceId. The function body encodes the access boundary (WHERE user_id = ...). EXECUTE is revoked from PUBLIC and granted only to server-only roles (service_role, postgres) so client roles cannot pass an arbitrary user_id to bypass RLS.';

COMMIT;
