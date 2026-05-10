-- Migration 026: Expand workspace_members.role to the canonical six roles (HEL-19)
--
-- Original enum from 001_autoflow_schema.sql: {owner, admin, member}.
--
-- Canonical role set (from the product model):
--   owner     — full access; billing; delete workspace
--   admin     — full operational access EXCEPT billing + delete
--   billing   — /api/billing/* only
--   operator  — runs / approvals / cost views
--   developer — workflows / connectors / LLM credentials
--   approver  — resolves approvals (HITL specialists)
--   member    — kept as a transitional role for pre-migration rows; treat as
--               least-privileged. New code should never assign 'member' on
--               creation; existing rows are upgraded as part of role
--               assignment work in HEL-69 (per-route role mapping).

BEGIN;

-- Drop the legacy CHECK and add the expanded one. Idempotent: re-running this
-- migration first drops the new constraint if it exists, then re-adds.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_members'::regclass
      AND conname = 'workspace_members_role_check'
  ) THEN
    ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_role_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_members'::regclass
      AND conname = 'workspace_members_role_canonical_check'
  ) THEN
    ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_role_canonical_check;
  END IF;

  ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_role_canonical_check
    CHECK (role IN ('owner', 'admin', 'billing', 'operator', 'developer', 'approver', 'member'));
END$$;

-- Index supporting role-based lookups (e.g. "give me all admins of workspace X").
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_role
  ON workspace_members (workspace_id, role);

COMMIT;
