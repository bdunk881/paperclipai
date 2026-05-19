-- Migration 047: list_agent_heartbeats_for_user helper (DASH-64.2
-- follow-up, addresses Codex review on PR #902).
--
-- Same shape as migration 046 for tasks. Cross-workspace observability
-- surfaces (GET /api/control-plane/heartbeats, agent activity dashboards)
-- need to read a user's heartbeats across every workspace they belong
-- to. agent_heartbeats has FORCE RLS so a raw query without
-- app.current_workspace_id returns zero rows.
--
-- This SECURITY DEFINER helper bypasses RLS for the specific
-- "all heartbeats this user produced" read pattern. The access
-- boundary (WHERE user_id = caller-supplied user) is encoded in the
-- function body. EXECUTE is revoked from PUBLIC and granted only to
-- server-only roles so client roles can't pass an arbitrary user_id.

BEGIN;

CREATE OR REPLACE FUNCTION list_agent_heartbeats_for_user(p_user_id text)
RETURNS SETOF agent_heartbeats
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_session_user text := app_current_user_id();
BEGIN
  -- DASH-64.2 iter 2 (Codex P1, same as migration 046): defense-in-depth
  -- against a backend bug calling with the wrong p_user_id. Returns
  -- zero rows when the session-bound subject doesn't match, or when
  -- the session var is unset (NULL-denial — same hardened pattern RLS
  -- policies use elsewhere). Backend MUST set
  -- `app.current_user_id` via set_config before calling.
  IF v_session_user IS NULL OR v_session_user <> p_user_id THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM agent_heartbeats WHERE user_id = p_user_id ORDER BY started_at DESC;
END;
$$;

ALTER FUNCTION list_agent_heartbeats_for_user(text) SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION list_agent_heartbeats_for_user(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_agent_heartbeats_for_user(text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_agent_heartbeats_for_user(text) TO postgres';
  END IF;
END $$;

COMMENT ON FUNCTION list_agent_heartbeats_for_user(text) IS
  'DASH-64.2: SECURITY DEFINER helper. Returns all agent_heartbeats rows owned by the given user across every workspace they belong to. Used by cross-workspace heartbeat dashboards. The function body encodes the access boundary (WHERE user_id = ...). EXECUTE is revoked from PUBLIC and granted only to server-only roles.';

COMMIT;
