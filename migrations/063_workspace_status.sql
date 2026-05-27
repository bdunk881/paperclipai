-- Migration 063: workspace status (active / locked / suspended).
--
-- Admin console workspace ops need a way to:
--   - 'locked'    — read-only mode; runtime stops scheduling agents but
--                   members can still view their data
--   - 'suspended' — abuse kill switch; no reads, no writes, no agents
--
-- The existing requireRole middleware does not block by status; downstream
-- read paths (queue scheduler, mission router, agent worker) consult
-- workspaces.status before continuing.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'suspended'));

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS status_changed_by text NULL,
  ADD COLUMN IF NOT EXISTS status_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_status
  ON workspaces (status)
  WHERE status <> 'active';

COMMIT;
