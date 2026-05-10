-- Migration 030: lookup_team_workspace_id helper (HEL-66)
--
-- The team→workspace cache miss in controlPlaneStore.workspaceContextForTeam
-- needs to find the workspace_id for a team WITHOUT having a workspace
-- context to set on the session — that's the whole point of the lookup.
-- agent_teams has FORCE RLS requiring app_current_workspace_id() IS NOT NULL,
-- so a raw SELECT returns zero rows.
--
-- This helper is SECURITY DEFINER so it executes as the function owner
-- (the migration role) and bypasses RLS for this single read. The function
-- only returns the workspace_id (a UUID); no workspace-scoped row data
-- leaks. Callers use it as the system-level lookup for "which workspace
-- does this team belong to" so they can THEN set the right workspace
-- context for downstream queries.
--
-- Returns NULL when the team doesn't exist.

BEGIN;

CREATE OR REPLACE FUNCTION lookup_team_workspace_id(p_team_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT workspace_id FROM agent_teams WHERE id = p_team_id LIMIT 1
$$;

-- Lock the search_path so the SECURITY DEFINER body can't be hijacked by
-- a malicious schema in front of public.
ALTER FUNCTION lookup_team_workspace_id(uuid) SET search_path = public, pg_catalog;

COMMENT ON FUNCTION lookup_team_workspace_id(uuid) IS
  'HEL-66: SECURITY DEFINER helper. Resolves a team''s workspace_id ' ||
  'without needing a workspace context. Returns NULL if the team does ' ||
  'not exist.';

COMMIT;
