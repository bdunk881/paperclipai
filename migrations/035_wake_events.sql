-- HEL-94 — Wake event log + triage audit
--
-- Replaces heartbeat polling with event-driven wake-ups. Every potential
-- wake source (scheduled cron, inbound webhook, @-mention, approval
-- resolution, direct user message, upstream agent completion) publishes a
-- normalized row here. The triage layer reads the row, applies the agent's
-- triage_policy (Layer 1 instruction kind='triage_policy'), and writes the
-- decision + reason back. ACTed events spawn a real agent run.
--
-- Append-only audit trail. TTL'd at 30 days for storage hygiene; agent
-- self-audit (list_recent_events tool) queries the live rows directly.

BEGIN;

CREATE TABLE IF NOT EXISTS wake_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  -- 'scheduled' | 'webhook' | 'mention' | 'approval_resolved' |
  -- 'user_message' | 'upstream_completed' | 'manual'
  source          TEXT NOT NULL,
  -- Provider/connector slug for webhooks (e.g., 'slack', 'stripe').
  -- Free-form description for other sources.
  source_ref      TEXT,
  -- Human-readable one-liner summary the triage layer reads. Required.
  summary         TEXT NOT NULL,
  -- Structured payload (whatever the source captured: webhook body, mention
  -- context, approval row, etc.). Caller responsibility to keep PII out.
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 'ACT' | 'DEFER' | 'IGNORE' | 'ESCALATE' | 'PENDING'
  decision        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (decision IN ('PENDING', 'ACT', 'DEFER', 'IGNORE', 'ESCALATE')),
  -- One-line reason from the triage call. Visible in the agent's
  -- list_recent_events tool output.
  decision_reason TEXT,
  -- When decision = ESCALATE, the agent_id of the escalation target.
  escalated_to    UUID REFERENCES agents(id) ON DELETE SET NULL,
  -- When decision = DEFER, the timestamp the event re-fires for re-triage.
  deferred_until  TIMESTAMPTZ,
  -- Cost of the triage call itself (USD, accumulating into spend tracking).
  triage_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  -- The run that was kicked off when decision=ACT. NULL otherwise.
  acted_run_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
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

CREATE OR REPLACE FUNCTION wake_events_set_expires_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.expires_at := NEW.created_at + INTERVAL '30 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wake_events_expires_at_trigger ON wake_events;
CREATE TRIGGER wake_events_expires_at_trigger
  BEFORE INSERT ON wake_events
  FOR EACH ROW EXECUTE FUNCTION wake_events_set_expires_at();

ALTER TABLE wake_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wake_events_member_access ON wake_events;
CREATE POLICY wake_events_member_access ON wake_events
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)
    )
  );

COMMIT;
