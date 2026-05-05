BEGIN;

-- Workspace defaults remain in notification_preferences. This table stores
-- per-user overrides that are resolved on top of those defaults.
CREATE TABLE IF NOT EXISTS user_notification_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'sms')),
  kind text NOT NULL CHECK (kind IN ('approvals', 'milestones', 'kpi_alerts', 'budget_alerts', 'kill_switch')),
  cadence text NOT NULL CHECK (cadence IN ('off', 'immediate', 'daily', 'weekly')),
  enabled boolean NOT NULL DEFAULT true,
  muted_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, channel, kind)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_overrides_workspace_user
  ON user_notification_overrides (workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_notification_overrides_workspace_kind
  ON user_notification_overrides (workspace_id, kind, channel);

ALTER TABLE user_notification_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notification_overrides_tenant_isolation ON user_notification_overrides;
CREATE POLICY user_notification_overrides_tenant_isolation
ON user_notification_overrides
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Provider identities are intentionally global in Phase 1 so the application
-- can detect collisions before a workspace-scoped merge prompt exists.
-- Access should remain server-side until the auth merge flow is implemented.
CREATE TABLE IF NOT EXISTS user_auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES social_auth_users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  provider_email text,
  provider_display_name text,
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(provider) <> ''),
  CHECK (btrim(provider_user_id) <> ''),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user
  ON user_auth_identities (user_id);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_email
  ON user_auth_identities (lower(provider_email))
  WHERE provider_email IS NOT NULL;

INSERT INTO user_auth_identities (
  user_id,
  provider,
  provider_user_id,
  provider_email,
  provider_display_name,
  profile_json,
  linked_at,
  last_login_at,
  created_at,
  updated_at
)
SELECT
  sau.id,
  sau.provider,
  sau.provider_user_id,
  sau.email,
  sau.display_name,
  jsonb_build_object('legacySource', 'social_auth_users'),
  sau.created_at,
  sau.last_login_at,
  sau.created_at,
  sau.last_login_at
FROM social_auth_users sau
ON CONFLICT (provider, provider_user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_auth_merge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  existing_user_id uuid REFERENCES social_auth_users(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES social_auth_users(id) ON DELETE SET NULL,
  decided_by_user_id uuid REFERENCES social_auth_users(id) ON DELETE SET NULL,
  incoming_identity_id uuid REFERENCES user_auth_identities(id) ON DELETE SET NULL,
  incoming_provider text NOT NULL,
  incoming_provider_user_id text NOT NULL,
  incoming_email text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_reason text,
  decision_reason text,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(incoming_provider) <> ''),
  CHECK (btrim(incoming_provider_user_id) <> ''),
  CHECK (
    (status = 'pending' AND responded_at IS NULL)
    OR (status <> 'pending' AND responded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_auth_merge_requests_workspace_status
  ON user_auth_merge_requests (workspace_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_auth_merge_requests_existing_user
  ON user_auth_merge_requests (existing_user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_auth_merge_requests_incoming_identity
  ON user_auth_merge_requests (incoming_provider, incoming_provider_user_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_merge_requests_pending_identity
  ON user_auth_merge_requests (workspace_id, existing_user_id, incoming_provider, incoming_provider_user_id)
  WHERE status = 'pending';

ALTER TABLE user_auth_merge_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_auth_merge_requests_tenant_isolation ON user_auth_merge_requests;
CREATE POLICY user_auth_merge_requests_tenant_isolation
ON user_auth_merge_requests
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

COMMIT;
