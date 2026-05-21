-- Migration 056: Live agent turn trace events for SSE replay

BEGIN;

CREATE TABLE IF NOT EXISTS agent_turn_trace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  seq integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_turn_trace_events_run_seq_unique UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS agent_turn_trace_events_workspace_run_idx
  ON agent_turn_trace_events (workspace_id, run_id, seq);

ALTER TABLE agent_turn_trace_events ENABLE ROW LEVEL SECURITY;

COMMIT;
