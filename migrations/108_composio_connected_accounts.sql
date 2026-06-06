-- Migration 108: composio_connected_accounts + composio_auth_configs (HEL-739 / P1a).
--
-- The persistence spine for the Composio integration broker (HEL-720 / HEL-721):
--   * composio_connected_accounts — a WORKSPACE's live connected accounts (its
--     link to a toolkit). Workspace-isolated RLS, mirroring migration 096.
--   * composio_auth_configs — the SHARED, project-wide toolkit -> auth-config
--     (ac_) cache. One shared Composio project (HEL-720) means this mapping is
--     identical for every workspace and holds NO secrets (managed auth: Composio
--     holds the credentials), so it is deliberately NOT workspace-scoped.
BEGIN;

-- ---------------------------------------------------------------------------
-- Per-workspace connected accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS composio_connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  toolkit text NOT NULL,
  connected_account_id text NOT NULL,
  auth_config_id text NOT NULL,
  status text NOT NULL DEFAULT 'INITIATED'
    CHECK (status IN ('INITIATED', 'ACTIVE', 'INACTIVE', 'EXPIRED')),
  created_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The Composio ca_ id is globally unique and minted per workspace userId, so
  -- a uuid surrogate PK + a unique ca_ id is the file_objects (096) idiom.
  CONSTRAINT composio_connected_accounts_ca_id_unique UNIQUE (connected_account_id)
);

CREATE INDEX IF NOT EXISTS idx_composio_connected_accounts_workspace_toolkit
  ON composio_connected_accounts (workspace_id, toolkit);
CREATE INDEX IF NOT EXISTS idx_composio_connected_accounts_workspace_active
  ON composio_connected_accounts (workspace_id)
  WHERE status = 'ACTIVE';

-- Per-table updated_at trigger (no shared helper in this codebase; cf. migration 067).
CREATE OR REPLACE FUNCTION composio_connected_accounts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS composio_connected_accounts_set_updated_at ON composio_connected_accounts;
CREATE TRIGGER composio_connected_accounts_set_updated_at
  BEFORE UPDATE ON composio_connected_accounts
  FOR EACH ROW EXECUTE FUNCTION composio_connected_accounts_touch_updated_at();

-- Row-Level Security: workspace isolation + platform-admin debug-read. FORCE so
-- the table owner is subject to the policy too (migration 014/096 GAP-1 idiom:
-- an unset workspace context must DENY, not silently return empty).
ALTER TABLE composio_connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE composio_connected_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS composio_connected_accounts_workspace_isolation ON composio_connected_accounts;
CREATE POLICY composio_connected_accounts_workspace_isolation ON composio_connected_accounts
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id::text = app_current_workspace_id()::text)
  WITH CHECK (app_current_workspace_id() IS NOT NULL
             AND workspace_id::text = app_current_workspace_id()::text);

DROP POLICY IF EXISTS composio_connected_accounts_admin_read ON composio_connected_accounts;
CREATE POLICY composio_connected_accounts_admin_read ON composio_connected_accounts
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- The non-superuser API role (migration 065, NOBYPASSRLS) needs explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.composio_connected_accounts TO autoflow_api;

-- ---------------------------------------------------------------------------
-- Shared, project-wide auth-config (ac_) cache — intentionally NOT workspace-scoped
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS composio_auth_configs (
  toolkit text PRIMARY KEY,
  auth_config_id text NOT NULL,
  is_composio_managed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS is enabled (the hardening regime expects it on every table) but the policy
-- is deliberately GLOBAL: with one shared Composio project (HEL-720) the
-- toolkit -> ac_ mapping is identical for all workspaces and contains no
-- secrets, so reads/writes are allowed regardless of workspace context.
ALTER TABLE composio_auth_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE composio_auth_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS composio_auth_configs_shared_access ON composio_auth_configs;
CREATE POLICY composio_auth_configs_shared_access ON composio_auth_configs
  AS PERMISSIVE FOR ALL TO public
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.composio_auth_configs TO autoflow_api;

COMMIT;
