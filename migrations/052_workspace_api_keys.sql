-- HEL-166: workspace-scoped platform API keys.
--
-- These keys grant programmatic access to AutoFlow APIs. The raw secret is
-- returned only once at creation/rotation time; persistence stores only a
-- SHA-256 hash plus non-sensitive mask parts for dashboard display.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                text NOT NULL,
  key_hash            text NOT NULL UNIQUE,
  key_prefix          text NOT NULL,
  key_last4           text NOT NULL,
  created_by_user_id  text NOT NULL,
  rotated_from_key_id uuid REFERENCES workspace_api_keys(id) ON DELETE SET NULL,
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_api_keys_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT workspace_api_keys_name_length CHECK (length(name) <= 80),
  CONSTRAINT workspace_api_keys_last4_length CHECK (length(key_last4) = 4)
);

CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_workspace_created
  ON workspace_api_keys (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_workspace_active
  ON workspace_api_keys (workspace_id, revoked_at)
  WHERE revoked_at IS NULL;

ALTER TABLE workspace_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_api_keys_tenant_isolation ON workspace_api_keys;
CREATE POLICY workspace_api_keys_tenant_isolation
ON workspace_api_keys
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);
