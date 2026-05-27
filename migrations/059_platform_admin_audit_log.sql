-- Migration 059: platform-admin audit log — cross-tenant append-only ledger.
--
-- The existing control_plane_audit_log (migration 020) is workspace-scoped via
-- RLS, which is correct for tenant-mutating actions but wrong-shape for
-- platform-admin actions that explicitly cross workspaces (e.g. "admin Alice
-- reset MFA for user Bob in workspace X"). This table is the receipt for every
-- privileged operation initiated from the admin console.
--
-- Hardening mirrors migration 020:
--   * append-only (RESTRICTIVE no-UPDATE / no-DELETE policies)
--   * RLS ENABLED + FORCED so even the table owner cannot bypass
--   * SELECT gated by the platform_admin session GUC (mirrors the
--     app_current_workspace_id() pattern used elsewhere)
--
-- Writes happen through src/adminConsole/auditLog.ts, which is the chokepoint
-- every privileged route MUST call before issuing the underlying privileged
-- side-effect.

BEGIN;

CREATE OR REPLACE FUNCTION app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    current_setting('app.is_platform_admin', true) = 'true',
    false
  );
$$;

COMMENT ON FUNCTION app_is_platform_admin() IS
  'Returns true when the current session has been marked platform-admin via SET LOCAL app.is_platform_admin = true. Set by requirePlatformAdmin middleware inside a transaction so the flag cannot leak via pool reuse.';

CREATE TABLE IF NOT EXISTS platform_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The platform-admin user who initiated the action.
  admin_user_id text NOT NULL,

  -- Free-form within the admin-console domain. Verbs are enumerated in
  -- src/adminConsole/auditLog.ts (ADMIN_ACTIONS) so the writer can validate
  -- without a schema migration when adding a new action.
  action text NOT NULL CHECK (length(action) > 0 AND length(action) <= 64),

  -- Optional pointers to the affected principal / scope. NULLs allowed because
  -- some admin actions are scope-free (e.g. "search users").
  target_user_id text NULL,
  target_workspace_id uuid NULL,

  -- Reason is required for high-impact actions; routes that don't require a
  -- reason pass an empty string. Stored regardless so audits show whatever the
  -- admin entered.
  reason text NOT NULL DEFAULT '',

  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),

  ip inet NULL,
  user_agent text NULL,

  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_admin_at
  ON platform_admin_audit_log (admin_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_target_user_at
  ON platform_admin_audit_log (target_user_id, occurred_at DESC)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_target_workspace_at
  ON platform_admin_audit_log (target_workspace_id, occurred_at DESC)
  WHERE target_workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_log_action_at
  ON platform_admin_audit_log (action, occurred_at DESC);

ALTER TABLE platform_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin_audit_log FORCE ROW LEVEL SECURITY;

-- Reads only when the session is marked platform-admin. Writes follow the
-- same rule so a non-admin context cannot insert spoofed rows.
DROP POLICY IF EXISTS platform_admin_audit_log_admin_only ON platform_admin_audit_log;
CREATE POLICY platform_admin_audit_log_admin_only
  ON platform_admin_audit_log
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- Append-only: no UPDATE / DELETE for anyone, ever.
DROP POLICY IF EXISTS platform_admin_audit_log_no_update ON platform_admin_audit_log;
CREATE POLICY platform_admin_audit_log_no_update
  ON platform_admin_audit_log
  AS RESTRICTIVE
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS platform_admin_audit_log_no_delete ON platform_admin_audit_log;
CREATE POLICY platform_admin_audit_log_no_delete
  ON platform_admin_audit_log
  AS RESTRICTIVE
  FOR DELETE
  USING (false);

COMMENT ON TABLE platform_admin_audit_log IS
  'Append-only ledger of every action initiated from the admin console. Cross-tenant by design; reads gated on app_is_platform_admin().';

COMMIT;
