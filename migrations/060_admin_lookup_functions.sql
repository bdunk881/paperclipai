-- Migration 060: SECURITY DEFINER cross-tenant lookups for the admin console.
--
-- Platform admins legitimately need to read across workspaces (find user by
-- email, list a user's workspaces, fetch their activity events). We do NOT
-- weaken the runtime DB role's RLS contract — instead, we expose narrow
-- SECURITY DEFINER functions that check `app_is_platform_admin()` before
-- returning data. This mirrors the existing list_*_for_user pattern in
-- migrations 046/047/048/049/050/051.
--
-- All functions return zero rows when the platform_admin GUC is not set,
-- which is the same "NULL-denial" hardening that RLS policies elsewhere use.
--
-- EXECUTE is revoked from PUBLIC and granted only to server-only roles so a
-- client role (anon/authenticated) cannot call these even if the JWT were
-- malformed.

BEGIN;

-- ------------------------------------------------------------------
-- admin_lookup_user_by_email
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_lookup_user_by_email(p_email text)
RETURNS TABLE (
  user_id text,
  display_name text,
  is_platform_admin boolean,
  timezone text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN
    RETURN;
  END IF;

  -- user_profiles doesn't carry email; auth.users (Supabase) does.
  -- Most code paths look up by sub (text uuid) — emails live in auth.users.
  -- We join both so admins can search by email and still get a profile.
  RETURN QUERY
    SELECT
      au.id::text AS user_id,
      up.display_name,
      coalesce(up.is_platform_admin, false) AS is_platform_admin,
      coalesce(up.timezone, 'UTC') AS timezone,
      au.created_at
    FROM auth.users AS au
    LEFT JOIN user_profiles AS up ON up.user_id = au.id::text
    WHERE lower(au.email) = lower(p_email)
    LIMIT 1;
END;
$$;

ALTER FUNCTION admin_lookup_user_by_email(text) SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION admin_lookup_user_by_email(text) FROM PUBLIC;

-- ------------------------------------------------------------------
-- admin_lookup_user_by_id
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_lookup_user_by_id(p_user_id text)
RETURNS TABLE (
  user_id text,
  email text,
  display_name text,
  is_platform_admin boolean,
  timezone text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      au.id::text AS user_id,
      au.email::text,
      up.display_name,
      coalesce(up.is_platform_admin, false) AS is_platform_admin,
      coalesce(up.timezone, 'UTC') AS timezone,
      au.created_at
    FROM auth.users AS au
    LEFT JOIN user_profiles AS up ON up.user_id = au.id::text
    WHERE au.id::text = p_user_id
    LIMIT 1;
END;
$$;

ALTER FUNCTION admin_lookup_user_by_id(text) SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION admin_lookup_user_by_id(text) FROM PUBLIC;

-- ------------------------------------------------------------------
-- admin_list_workspaces_for_user
-- Returns every workspace the target user is a member of.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_list_workspaces_for_user(p_user_id text)
RETURNS TABLE (
  workspace_id uuid,
  name text,
  role text,
  owner_user_id text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      w.id AS workspace_id,
      w.name,
      wm.role,
      w.owner_user_id,
      w.created_at
    FROM workspace_members AS wm
    JOIN workspaces AS w ON w.id = wm.workspace_id
    WHERE wm.user_id = p_user_id
    ORDER BY w.created_at ASC;
END;
$$;

ALTER FUNCTION admin_list_workspaces_for_user(text) SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION admin_list_workspaces_for_user(text) FROM PUBLIC;

-- ------------------------------------------------------------------
-- admin_recent_activity_for_user
-- Returns the target user's last N activity_events across every workspace
-- they belong to. Used by the Customer-360 activity timeline.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_recent_activity_for_user(
  p_user_id text,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  kind text,
  actor jsonb,
  subject jsonb,
  payload jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
  IF NOT app_is_platform_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      ae.id,
      ae.workspace_id,
      ae.kind,
      ae.actor,
      ae.subject,
      ae.payload,
      ae.occurred_at
    FROM activity_events AS ae
    WHERE ae.workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members AS wm WHERE wm.user_id = p_user_id
    )
    AND (
      ae.actor ->> 'id' = p_user_id
      OR ae.subject ->> 'user_id' = p_user_id
    )
    ORDER BY ae.occurred_at DESC, ae.id DESC
    LIMIT v_limit;
END;
$$;

ALTER FUNCTION admin_recent_activity_for_user(text, integer)
  SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION admin_recent_activity_for_user(text, integer) FROM PUBLIC;

-- ------------------------------------------------------------------
-- Grants — postgres + service_role only (mirrors migrations 046+).
-- ------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  role_name text;
BEGIN
  FOR fn IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_lookup_user_by_email',
        'admin_lookup_user_by_id',
        'admin_list_workspaces_for_user',
        'admin_recent_activity_for_user'
      )
  LOOP
    FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
