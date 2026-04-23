BEGIN;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  template_id text NOT NULL,
  template_name text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'escalated', 'awaiting_approval')
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_template_id
  ON workflow_runs (template_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON workflow_runs (status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at
  ON workflow_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS memory_entries (
  id text PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_memory_entries_user_workflow
  ON memory_entries (user_id, workflow_id);

CREATE INDEX IF NOT EXISTS idx_memory_entries_user_agent
  ON memory_entries (user_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_memory_entries_expires_at
  ON memory_entries (expires_at);

CREATE TABLE IF NOT EXISTS workflow_approval_requests (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  template_id text NOT NULL,
  template_name text NOT NULL,
  step_id text NOT NULL,
  step_name text NOT NULL,
  assignee text NOT NULL,
  assignees text[] NOT NULL DEFAULT ARRAY[]::text[],
  message text NOT NULL,
  timeout_minutes integer NOT NULL CHECK (timeout_minutes > 0),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_changes_step_id text,
  status text NOT NULL CHECK (
    status IN ('pending', 'approved', 'rejected', 'request_changes', 'timed_out')
  ),
  resolved_at timestamptz,
  comment text,
  decided_by text,
  decision_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step_index integer NOT NULL CHECK (current_step_index >= 0),
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_results_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_approval_requests_run_id
  ON workflow_approval_requests (run_id);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_status
  ON workflow_approval_requests (status);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_assignee
  ON workflow_approval_requests (assignee);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_requested_at
  ON workflow_approval_requests (requested_at DESC);

COMMIT;
