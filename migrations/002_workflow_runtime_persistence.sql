BEGIN;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY,
  template_id text NOT NULL,
  template_name text NOT NULL,
  user_id text,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'escalated', 'awaiting_approval')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_template_id
  ON workflow_runs (template_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON workflow_runs (status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at
  ON workflow_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS workflow_step_results (
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  step_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure', 'skipped', 'running')),
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  error text,
  agent_slot_results_json jsonb,
  cost_log_json jsonb,
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_results_run_ordinal
  ON workflow_step_results (run_id, ordinal);

CREATE TABLE IF NOT EXISTS memory_entries (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  workflow_id text,
  workflow_name text,
  agent_id text,
  key text NOT NULL,
  text_value text NOT NULL,
  ttl_seconds integer,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_user_id
  ON memory_entries (user_id);

CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_key
  ON memory_entries (user_id, key, workflow_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_memory_entries_expires_at
  ON memory_entries (expires_at);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  user_id text,
  template_name text NOT NULL,
  step_id text NOT NULL,
  step_name text NOT NULL,
  assignee text NOT NULL,
  message text NOT NULL,
  timeout_minutes integer NOT NULL CHECK (timeout_minutes > 0),
  requested_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'timed_out')),
  resolved_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_run_id
  ON approval_requests (run_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
  ON approval_requests (status);

COMMIT;
