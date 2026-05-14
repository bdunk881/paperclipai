-- HEL-94 — Wake event log (Supabase mirror of migrations/035)

BEGIN;

CREATE TABLE IF NOT EXISTS wake_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  source          TEXT NOT NULL,
  source_ref      TEXT,
  summary         TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (decision IN ('PENDING', 'ACT', 'DEFER', 'IGNORE', 'ESCALATE')),
  decision_reason TEXT,
  escalated_to    UUID REFERENCES agents(id) ON DELETE SET NULL,
  deferred_until  TIMESTAMPTZ,
  triage_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  acted_run_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ GENERATED ALWAYS AS
                  (created_at + INTERVAL '30 days') STORED
);

CREATE INDEX IF NOT EXISTS wake_events_workspace_agent_idx
  ON wake_events (workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wake_events_pending_idx
  ON wake_events (workspace_id, created_at DESC)
  WHERE decision = 'PENDING';
CREATE INDEX IF NOT EXISTS wake_events_deferred_idx
  ON wake_events (deferred_until)
  WHERE decision = 'DEFER' AND deferred_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS wake_events_expires_idx ON wake_events (expires_at);

ALTER TABLE wake_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wake_events_member_access ON wake_events;
CREATE POLICY wake_events_member_access ON wake_events
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

COMMIT;
