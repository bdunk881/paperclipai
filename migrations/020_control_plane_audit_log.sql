-- Migration 020: Centralized cross-phase audit log (ALT-2078 / ALT-1915 Phase 5)
--
-- Unifies the per-phase audit surfaces (currently only `control_plane_secret_audit`
-- from migration 017/018) behind a single tenant-scoped, append-only ledger so SIEM
-- and compliance reviewers have one place to look for tenant-mutating actions.
--
-- Same hardened isolation pattern as migrations 014/015/016/017/018/019:
--   * workspace_id = app_current_workspace_id() AND app_current_workspace_id() IS NOT NULL
--     so a missing session variable denies rows rather than silently returning empty
--   * ENABLE + FORCE ROW LEVEL SECURITY so the table owner cannot bypass policies
--   * Append-only enforced via RESTRICTIVE no-UPDATE / no-DELETE policies (the
--     migration-018 lesson: permissive policies OR together, restrictive AND)
--
-- This table coexists with `control_plane_secret_audit` during the migration
-- window. Secret callsites continue to write to both ledgers until a future
-- migration deprecates the per-phase table.
--
-- Categories enumerate the cross-phase boundaries that emit audit rows:
--   secret           - Phase 3 secrets ops (mirrors control_plane_secret_audit rows)
--   provisioning     - Phase 2 company / workspace provisioning lifecycle
--   team_lifecycle   - Phase 2 team create / delete / membership change
--   agent_lifecycle  - Phase 2 agent create / delete / config change
--   execution        - Phase 4 execution boot / end / heartbeat lifecycle
--   auth             - Phase 1 / 5 authentication and session events
--   bypass_attempt   - Phase 5 QA bypass flag activations (production-boot guard)
--
-- The `action` field is free-form within a category so individual phases can
-- enumerate their own verbs (e.g. provisioning -> create, deprovision; auth ->
-- login, refresh, logout) without needing a coordinated schema change.

BEGIN;

CREATE TABLE IF NOT EXISTS control_plane_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- At least one of these must be present (CHECK constraint below). Server-
  -- derived from workspace context, never caller-supplied free-form. Mirrors
  -- the ALT-2027 split on control_plane_secret_audit so a workspace-scoped
  -- caller cannot spoof another principal in the audit ledger.
  actor_user_id text NULL,
  actor_agent_id text NULL,

  category text NOT NULL
    CHECK (category IN (
      'secret',
      'provisioning',
      'team_lifecycle',
      'agent_lifecycle',
      'execution',
      'auth',
      'bypass_attempt'
    )),

  -- Free-form within a category. Per-phase enumerations are validated in
  -- application code (auditService) so adding a new verb does not require a
  -- schema migration.
  action text NOT NULL CHECK (length(action) > 0 AND length(action) <= 64),

  -- Optional pointer to the entity the action mutated. target_type matches the
  -- domain table or logical entity name (e.g. 'provisioned_company',
  -- 'control_plane_team', 'control_plane_agent', 'control_plane_execution').
  target_type text NULL,
  target_id text NULL,

  metadata jsonb NULL,

  at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT control_plane_audit_log_actor_present
    CHECK (actor_user_id IS NOT NULL OR actor_agent_id IS NOT NULL)
);

-- Hot paths for SIEM / compliance review: by workspace + time, by category +
-- time, and by actor for "what did principal X do" queries.
CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_workspace_at
  ON control_plane_audit_log (workspace_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_category_at
  ON control_plane_audit_log (category, at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_target
  ON control_plane_audit_log (target_type, target_id)
  WHERE target_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_actor_user
  ON control_plane_audit_log (actor_user_id, at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_actor_agent
  ON control_plane_audit_log (actor_agent_id, at DESC)
  WHERE actor_agent_id IS NOT NULL;

ALTER TABLE control_plane_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_audit_log_tenant_isolation ON control_plane_audit_log;
CREATE POLICY control_plane_audit_log_tenant_isolation
ON control_plane_audit_log
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Append-only: deny UPDATE and DELETE on audit rows even for the table owner.
-- Restrictive policies AND together (vs. permissive which OR), which is what
-- append-only enforcement requires when the tenant_isolation policy already
-- permits SELECT/INSERT inside the owning workspace.
DROP POLICY IF EXISTS control_plane_audit_log_no_update ON control_plane_audit_log;
CREATE POLICY control_plane_audit_log_no_update
  ON control_plane_audit_log
  AS RESTRICTIVE
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS control_plane_audit_log_no_delete ON control_plane_audit_log;
CREATE POLICY control_plane_audit_log_no_delete
  ON control_plane_audit_log
  AS RESTRICTIVE
  FOR DELETE
  USING (false);

COMMIT;
