BEGIN;

CREATE TABLE IF NOT EXISTS workflow_queue_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'completed', 'failed')),
  error text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_jobs_template_status
  ON workflow_queue_jobs (template_id, status, enqueued_at);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_jobs_run_id
  ON workflow_queue_jobs (run_id);

COMMIT;
