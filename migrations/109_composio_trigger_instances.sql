-- Migration 109: composio_trigger_instances (HEL-764 / P4-0).
--
-- A workspace's live Composio TRIGGER subscriptions: a (toolkit, trigger_slug)
-- bound to a connected account (ca_) and the AGENT it should wake, keyed by the
-- globally-unique Composio trigger id (ti_). Workspace-isolated RLS, mirroring
-- migration 108 (composio_connected_accounts). The sessionless trigger webhook
-- (P4-b) reads a row by ti_ under withSystemAdminContext via the admin_read
-- policy, exactly like connectedAccountStore.findByConnectedAccountId.
--
-- Also adds app_resolve_workspace_owner(uuid) — a generic, non-comms-scoped twin
-- of comms_resolve_workspace_owner (migration 103) so the trigger ingest can
-- resolve a member user to publish wake_events under (membership-gated RLS)
-- without a session.
BEGIN;

CREATE TABLE IF NOT EXISTS composio_trigger_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  toolkit text NOT NULL,
  trigger_slug text NOT NULL,
  trigger_id text NOT NULL,
  connected_account_id text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ENABLED'
    CHECK (status IN ('ENABLED', 'DISABLED', 'ERROR')),
  created_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The Composio ti_ id is globally unique (minted per workspace userId), so a
  -- uuid surrogate PK + a unique ti_ id mirrors composio_connected_accounts (108).
  CONSTRAINT composio_trigger_instances_ti_id_unique UNIQUE (trigger_id)
);

CREATE INDEX IF NOT EXISTS idx_composio_trigger_instances_workspace_toolkit
  ON composio_trigger_instances (workspace_id, toolkit);
CREATE INDEX IF NOT EXISTS idx_composio_trigger_instances_workspace_enabled
  ON composio_trigger_instances (workspace_id)
  WHERE status = 'ENABLED';
CREATE INDEX IF NOT EXISTS idx_composio_trigger_instances_agent
  ON composio_trigger_instances (agent_id);

-- Per-table updated_at trigger (no shared helper in this codebase; cf. migration 108).
CREATE OR REPLACE FUNCTION composio_trigger_instances_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS composio_trigger_instances_set_updated_at ON composio_trigger_instances;
CREATE TRIGGER composio_trigger_instances_set_updated_at
  BEFORE UPDATE ON composio_trigger_instances
  FOR EACH ROW EXECUTE FUNCTION composio_trigger_instances_touch_updated_at();

-- Row-Level Security: workspace isolation + platform-admin debug/sessionless read.
-- FORCE so the table owner is subject too (migration 108 idiom: an unset
-- workspace context must DENY, not silently return empty).
ALTER TABLE composio_trigger_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE composio_trigger_instances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS composio_trigger_instances_workspace_isolation ON composio_trigger_instances;
CREATE POLICY composio_trigger_instances_workspace_isolation ON composio_trigger_instances
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id::text = app_current_workspace_id()::text)
  WITH CHECK (app_current_workspace_id() IS NOT NULL
             AND workspace_id::text = app_current_workspace_id()::text);

-- admin_read admits the sessionless ti_ lookup (findByTriggerId runs under
-- withSystemAdminContext → app_is_platform_admin()), mirroring migration 108.
DROP POLICY IF EXISTS composio_trigger_instances_admin_read ON composio_trigger_instances;
CREATE POLICY composio_trigger_instances_admin_read ON composio_trigger_instances
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- The non-superuser API role (migration 065, NOBYPASSRLS) needs explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.composio_trigger_instances TO autoflow_api;

-- ---------------------------------------------------------------------------
-- app_resolve_workspace_owner — generic (non-comms) twin of
-- comms_resolve_workspace_owner (migration 103). The sessionless trigger-webhook
-- ingest (P4-b) resolves the workspace from the event's user_id (= ws_<id>) and
-- then needs a real workspace member to publish membership-gated wake_events
-- under. SECURITY DEFINER, search_path-pinned, EXECUTE revoked from PUBLIC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_resolve_workspace_owner(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT w.owner_user_id
  FROM workspaces AS w
  WHERE w.id = p_workspace_id
  LIMIT 1;
$$;

ALTER FUNCTION app_resolve_workspace_owner(uuid)
  SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION app_resolve_workspace_owner(uuid) FROM PUBLIC;

COMMENT ON FUNCTION app_resolve_workspace_owner(uuid) IS
  'HEL-764: SECURITY DEFINER. Returns a workspace''s owner user id (a member) so a sessionless webhook ingest can publish wake_events under that workspace''s membership-gated RLS. Generic twin of comms_resolve_workspace_owner (103).';

-- Grants — server-only roles (mirrors 103). Guarded so a less-provisioned env
-- (local dev without service_role / autoflow_api) doesn't trip the migration.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role', 'autoflow_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.app_resolve_workspace_owner(uuid) TO %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
