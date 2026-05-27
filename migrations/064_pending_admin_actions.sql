-- Migration 064: pending admin actions — two-person rule for kill-switch ops.
--
-- High-impact admin actions (workspace suspension, right-to-erasure delete)
-- require a second platform admin to confirm before they fire. The first admin
-- queues the action here; the second pulls it from /admin/pending and
-- confirms. The action handler validates that the confirming admin is NOT the
-- requesting admin and that the row has not expired.

BEGIN;

CREATE TABLE IF NOT EXISTS pending_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Action verb; the executor switches on this to invoke the right handler.
  action text NOT NULL
    CHECK (action IN (
      'suspend_workspace',
      'delete_user',
      'transfer_workspace_ownership'
    )),

  requested_by_user_id text NOT NULL,
  reason text NOT NULL DEFAULT '',

  target_user_id text NULL,
  target_workspace_id uuid NULL,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),

  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  confirmed_by_user_id text NULL,
  confirmed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancelled_by_user_id text NULL,

  CONSTRAINT pending_admin_actions_distinct_admins
    CHECK (confirmed_by_user_id IS NULL OR confirmed_by_user_id <> requested_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_admin_actions_status_expires
  ON pending_admin_actions (status, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_admin_actions_target_workspace
  ON pending_admin_actions (target_workspace_id)
  WHERE target_workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_admin_actions_target_user
  ON pending_admin_actions (target_user_id)
  WHERE target_user_id IS NOT NULL;

ALTER TABLE pending_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_admin_actions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_admin_actions_admin_only ON pending_admin_actions;
CREATE POLICY pending_admin_actions_admin_only
  ON pending_admin_actions
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
