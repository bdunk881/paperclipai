BEGIN;

CREATE TABLE IF NOT EXISTS approval_tier_policies (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (
    action_type IN (
      'spend_above_threshold',
      'contracts',
      'public_posts',
      'customer_facing_comms',
      'code_merges_to_prod'
    )
  ),
  mode text NOT NULL CHECK (
    mode IN ('auto_approve', 'notify_only', 'require_approval')
  ),
  spend_threshold_cents integer CHECK (spend_threshold_cents IS NULL OR spend_threshold_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, action_type)
);

COMMIT;
