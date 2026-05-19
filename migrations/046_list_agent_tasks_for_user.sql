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

COMMENT ON FUNCTION list_agent_tasks_for_user(text) IS
  'DASH-64.1: SECURITY DEFINER helper. Returns all agent_tasks rows owned by the given user across every workspace they belong to. Used by cross-workspace observability/reporting surfaces that have a userId but no resolved workspaceId. The function body encodes the access boundary (WHERE user_id = ...) so RLS bypass is scoped to this single read pattern.';

COMMIT;
