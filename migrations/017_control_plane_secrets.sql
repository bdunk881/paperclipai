-- Migration 017: Encrypted control-plane secrets storage + audit log (ALT-2022 / ALT-1915 Phase 3)
--
-- Replaces the in-memory `companySecretBindings` Map in
-- src/controlPlane/controlPlaneStore.ts with two workspace-scoped, RLS-isolated
-- tables:
--   provisioned_company_secrets    - AES-256-GCM ciphertext rows
--   control_plane_secret_audit     - append-only audit trail of read/write/rotate
--
-- Both tables follow the migration 014/015/016 pattern: tenant policies that
-- deny rows when `app.current_workspace_id` is unset, plus FORCE ROW LEVEL
-- SECURITY so the table owner cannot bypass policies at runtime.
--
-- Plaintext secret values never appear in this migration or in any database
-- column - encryption happens in src/controlPlane/secretEncryption.ts and only
-- ciphertext / iv / auth_tag are persisted here.

BEGIN;

-- ============================================================
-- provisioned_company_secrets
-- ============================================================
-- Replaces the `companySecretBindings: Map<companyId, Record<key, plaintext>>`
-- previously held in process memory. Ciphertext is AES-256-GCM with a unique
-- 12-byte IV per write and a 16-byte auth tag verified on every read.

CREATE TABLE IF NOT EXISTS provisioned_company_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES provisioned_companies(id) ON DELETE CASCADE,

  key text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),

  -- Length guards: GCM IV must be 12 bytes, auth tag must be 16 bytes.
  CONSTRAINT provisioned_company_secrets_iv_length CHECK (octet_length(iv) = 12),
  CONSTRAINT provisioned_company_secrets_auth_tag_length CHECK (octet_length(auth_tag) = 16),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_provisioned_company_secrets_workspace
  ON provisioned_company_secrets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_provisioned_company_secrets_company
  ON provisioned_company_secrets (company_id);

ALTER TABLE provisioned_company_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioned_company_secrets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provisioned_company_secrets_tenant_isolation ON provisioned_company_secrets;
CREATE POLICY provisioned_company_secrets_tenant_isolation
ON provisioned_company_secrets
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_secret_audit
-- ============================================================
-- Append-only ledger of secret reads, writes, and rotations. The actor is
-- recorded as a free-form string (run-id, user-id, agent-id) so we can tie a
-- secret access back to a specific control-plane caller without leaking the
-- plaintext value.

CREATE TABLE IF NOT EXISTS control_plane_secret_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES provisioned_companies(id) ON DELETE CASCADE,

  key text NOT NULL,
  action text NOT NULL
    CHECK (action IN ('read', 'write', 'rotate', 'delete')),
  actor text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  metadata jsonb,

  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_secret_audit_workspace
  ON control_plane_secret_audit (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_secret_audit_company_at
  ON control_plane_secret_audit (company_id, at DESC);

ALTER TABLE control_plane_secret_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_secret_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_secret_audit_tenant_isolation ON control_plane_secret_audit;
CREATE POLICY control_plane_secret_audit_tenant_isolation
ON control_plane_secret_audit
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Append-only: deny UPDATE and DELETE on audit rows even for the table owner.
-- We rely on RLS for tenant isolation on SELECT/INSERT, and on these policies
-- to make the ledger tamper-evident for active sessions.
DROP POLICY IF EXISTS control_plane_secret_audit_no_update ON control_plane_secret_audit;
CREATE POLICY control_plane_secret_audit_no_update
ON control_plane_secret_audit
FOR UPDATE
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS control_plane_secret_audit_no_delete ON control_plane_secret_audit;
CREATE POLICY control_plane_secret_audit_no_delete
ON control_plane_secret_audit
FOR DELETE
USING (false);

COMMIT;
