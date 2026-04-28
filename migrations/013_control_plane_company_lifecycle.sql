BEGIN;

CREATE TABLE IF NOT EXISTS control_plane_company_lifecycle (
  user_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  pause_reason text,
  paused_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_run_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS control_plane_company_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('pause', 'resume')),
  reason text,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  affected_team_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_control_plane_company_lifecycle_audit_user_created
  ON control_plane_company_lifecycle_audit (user_id, created_at DESC);

COMMIT;
