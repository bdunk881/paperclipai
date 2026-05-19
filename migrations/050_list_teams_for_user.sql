-- Migration 050: list_teams_for_user helper (DASH-64.6).
--
-- Same shape as migrations 046/047/048/049 (tasks, heartbeats,
-- executions, agents). With DASH-64.6, the in-memory `teams` Map in
-- controlPlaneStore is dropped and listAccessibleTeamIds + dashboard
-- listings route through controlPlaneRepository. Cross-workspace
-- surfaces (`controlPlaneStore.listTeams(userId)` with no workspace
-- pinned) need to span every workspace the caller belongs to. The
-- agent_teams table has FORCE RLS so a raw query without
-- `app.current_workspace_id` returns zero rows.
--
-- This SECURITY DEFINER helper bypasses RLS for the specific
-- "all teams this user owns" read pattern. The access boundary
-- (WHERE user_id = session-bound caller) is encoded in the function
-- body. EXECUTE is revoked from PUBLIC and granted only to
-- server-only roles so client roles can't pass an arbitrary user_id.

BEGIN;

CREATE OR REPLACE FUNCTION list_teams_for_user(p_user_id text)
RETURNS SETOF agent_teams
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_session_user text := app_current_user_id();
BEGIN
  -- DASH-64.6 (mirrors 046/047/048/049 hardening): defense-in-depth
  -- against a backend bug calling with the wrong p_user_id. Returns
  -- zero rows when the session-bound subject doesn't match, or when
  -- the session var is unset (NULL-denial — same hardened pattern RLS
  -- policies use elsewhere). Backend MUST set `app.current_user_id`
  -- via set_config before calling.
  IF v_session_user IS NULL OR v_session_user <> p_user_id THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM agent_teams WHERE user_id = p_user_id ORDER BY created_at ASC;
END;
$$;

ALTER FUNCTION list_teams_for_user(text) SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION list_teams_for_user(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_teams_for_user(text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_teams_for_user(text) TO postgres';
  END IF;
END $$;

COMMENT ON FUNCTION list_teams_for_user(text) IS
  'DASH-64.6: SECURITY DEFINER helper. Returns all agent_teams rows owned by the given user across every workspace they belong to. Used by cross-workspace dashboard surfaces. The function body encodes the access boundary (WHERE user_id = ...). EXECUTE is revoked from PUBLIC and granted only to server-only roles.';

COMMIT;
