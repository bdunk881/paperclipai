BEGIN;

CREATE TABLE IF NOT EXISTS approval_notifications (
  id uuid PRIMARY KEY,
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  step_id text NOT NULL,
  step_name text NOT NULL,
  recipient text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('inbox', 'email')),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_notifications_approval_request_id
  ON approval_notifications (approval_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_notifications_status
  ON approval_notifications (status);

COMMIT;
