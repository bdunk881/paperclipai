-- Migration 051: list_companies_for_user helper (DASH-64.7).
--
-- Same shape as migrations 046/047/048/049/050. With DASH-64.7, the
-- in-memory `companies` + `companyWorkspaces` + `companyIdempotencyIndex`
-- Maps in controlPlaneStore are dropped. Idempotency-replay and the
-- listAccessibleTeamIds "add company-tenant teams" filter both need
-- cross-workspace company reads, which require a SECURITY DEFINER
-- helper because `companies` has FORCE RLS.
--
-- The helper bypasses RLS for the specific "all companies this user
-- owns" read pattern. EXECUTE is revoked from PUBLIC and granted only
-- to server-only roles so client roles can't pass an arbitrary
-- user_id.

BEGIN;

CREATE OR REPLACE FUNCTION list_companies_for_user(p_user_id text)
RETURNS SETOF companies
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_session_user text := app_current_user_id();
BEGIN
  -- DASH-64.7 (mirrors 046-050 hardening): defense-in-depth against
  -- backend bugs calling with the wrong p_user_id. NULL-denial when
  -- the session-bound subject doesn't match.
  IF v_session_user IS NULL OR v_session_user <> p_user_id THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM companies WHERE user_id = p_user_id ORDER BY created_at ASC;
END;
$$;

ALTER FUNCTION list_companies_for_user(text) SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION list_companies_for_user(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_companies_for_user(text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION list_companies_for_user(text) TO postgres';
  END IF;
END $$;

COMMENT ON FUNCTION list_companies_for_user(text) IS
  'DASH-64.7: SECURITY DEFINER helper. Returns all provisioned-company rows owned by the given user across every workspace they belong to. Used by idempotency-replay + listAccessibleTeamIds cross-workspace surfaces. The function body encodes the access boundary (WHERE user_id = ...). EXECUTE is revoked from PUBLIC and granted only to server-only roles.';

COMMIT;
