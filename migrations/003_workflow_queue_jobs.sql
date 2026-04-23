BEGIN;

CREATE TABLE IF NOT EXISTS workflow_queue_jobs (
  run_id text PRIMARY KEY,
  template_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'retrying', 'completed', 'failed', 'dropped')
  ),
  last_error text,
  available_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_jobs_template_id
  ON workflow_queue_jobs (template_id);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_jobs_status
  ON workflow_queue_jobs (status);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_jobs_available_at
  ON workflow_queue_jobs (available_at);

COMMIT;
