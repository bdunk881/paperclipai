-- HEL-206: workspace-scoped environment variables (Pro surface).
--
-- High-trust surface for storing secret env vars that agents/missions may read
-- at run-time. Mirrors the migration 017 / 018 `provisioned_company_secrets`
-- pattern: AES-256-GCM ciphertext stored as `encrypted_value` bytea with a
-- `key_version` column so we can rotate the master key, plus a per-row audit
-- ledger that follows the same RESTRICTIVE append-only stance as
-- `control_plane_secret_audit`.
--
-- Three tables in this migration:
--   workspace_env_vars        - encrypted key/value rows, one per (workspace, name).
--   workspace_env_var_grants  - per-scope (mission/team/agent) allow/ask/deny grants.
--   workspace_env_var_audit   - append-only ledger of create/read/rotate/delete + grant changes.
--
-- All three tables are RLS-scoped to `app_current_workspace_id()` exactly like
-- the rest of the workspace surface (migrations 014/017/052). The spec text
-- references `auth.uid()` + `workspace_members` joins (Supabase-flavoured); we
-- intentionally use the existing codebase pattern instead so this migration
-- composes with `withWorkspaceContext()` and the rest of the RLS hardening.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- workspace_env_vars
-- ============================================================
-- Plaintext never persists. `encrypted_value` is AES-256-GCM ciphertext bound
-- to a `key_version`, written via the existing `encryptSecret()` helper in
-- src/controlPlane/secretEncryption.ts. The route layer is responsible for
-- decrypting only on the deref path (never on list).

CREATE TABLE IF NOT EXISTS workspace_env_vars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  encrypted_value bytea NOT NULL,
  key_version     integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),

  -- The AES-256-GCM IV (12 bytes) and auth tag (16 bytes) live alongside the
  -- ciphertext so the deref path can rebuild the EncryptedSecret record.
  -- Stored as separate columns to match the migration 017 schema rather than
  -- bundling into `encrypted_value`, so length CHECKs are enforceable.
  iv              bytea NOT NULL,
  auth_tag        bytea NOT NULL,

  CONSTRAINT workspace_env_vars_iv_length CHECK (octet_length(iv) = 12),
  CONSTRAINT workspace_env_vars_auth_tag_length CHECK (octet_length(auth_tag) = 16),
  CONSTRAINT workspace_env_vars_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT workspace_env_vars_name_length CHECK (length(name) <= 200),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  created_by_user_id text,

  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_env_vars_workspace
  ON workspace_env_vars (workspace_id);

ALTER TABLE workspace_env_vars ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_env_vars FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_env_vars_tenant_isolation ON workspace_env_vars;
CREATE POLICY workspace_env_vars_tenant_isolation
ON workspace_env_vars
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- workspace_env_var_grants
-- ============================================================
-- Per-scope (mission / team / agent) allow/ask/deny grants. `scope_id` is text
-- because mission/team/agent ids are stored as text in some legacy tables and
-- uuid in others; the route layer normalises before lookup.

CREATE TABLE IF NOT EXISTS workspace_env_var_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  env_var_id  uuid NOT NULL REFERENCES workspace_env_vars(id) ON DELETE CASCADE,
  scope_kind  text NOT NULL CHECK (scope_kind IN ('mission', 'team', 'agent')),
  scope_id    text NOT NULL,
  permission  text NOT NULL CHECK (permission IN ('allow', 'ask', 'deny')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_env_var_grants_scope_id_present CHECK (length(btrim(scope_id)) > 0),

  UNIQUE (env_var_id, scope_kind, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_env_var_grants_env_var
  ON workspace_env_var_grants (env_var_id);

ALTER TABLE workspace_env_var_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_env_var_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_env_var_grants_tenant_isolation ON workspace_env_var_grants;
CREATE POLICY workspace_env_var_grants_tenant_isolation
ON workspace_env_var_grants
USING (
  env_var_id IN (
    SELECT id FROM workspace_env_vars
     WHERE workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  env_var_id IN (
    SELECT id FROM workspace_env_vars
     WHERE workspace_id = app_current_workspace_id()
  )
);

-- ============================================================
-- workspace_env_var_audit
-- ============================================================
-- Append-only ledger. Mirrors `control_plane_secret_audit` (migration 017/018):
-- RESTRICTIVE no-UPDATE / no-DELETE policies so even the table owner cannot
-- tamper with rows at runtime.

CREATE TABLE IF NOT EXISTS workspace_env_var_audit (
  id           bigserial PRIMARY KEY,
  env_var_id   uuid NOT NULL REFERENCES workspace_env_vars(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN (
    'create', 'read', 'rotate', 'delete',
    'grants_upsert', 'deref_token_issue'
  )),
  actor_id     text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_env_var_audit_env_var_at
  ON workspace_env_var_audit (env_var_id, created_at DESC);

ALTER TABLE workspace_env_var_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_env_var_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_env_var_audit_tenant_isolation ON workspace_env_var_audit;
CREATE POLICY workspace_env_var_audit_tenant_isolation
ON workspace_env_var_audit
USING (
  env_var_id IN (
    SELECT id FROM workspace_env_vars
     WHERE workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  env_var_id IN (
    SELECT id FROM workspace_env_vars
     WHERE workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS workspace_env_var_audit_no_update ON workspace_env_var_audit;
CREATE POLICY workspace_env_var_audit_no_update
  ON workspace_env_var_audit
  AS RESTRICTIVE
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS workspace_env_var_audit_no_delete ON workspace_env_var_audit;
CREATE POLICY workspace_env_var_audit_no_delete
  ON workspace_env_var_audit
  AS RESTRICTIVE
  FOR DELETE
  USING (false);

COMMIT;
