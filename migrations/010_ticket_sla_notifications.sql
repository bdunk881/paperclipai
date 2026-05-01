BEGIN;

CREATE TABLE IF NOT EXISTS ticket_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  first_response_target_json jsonb NOT NULL,
  resolution_target_json jsonb NOT NULL,
  at_risk_threshold numeric(5,4) NOT NULL DEFAULT 0.75,
  escalation_json jsonb NOT NULL DEFAULT '{"notify":true,"autoBumpPriority":false,"autoReassign":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, priority)
);

CREATE TABLE IF NOT EXISTS ticket_sla_snapshots (
  ticket_id uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES ticket_sla_policies(id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  state text NOT NULL CHECK (state IN ('untracked', 'on_track', 'at_risk', 'breached', 'paused')),
  phase text NOT NULL CHECK (phase IN ('first_response', 'resolution', 'resolved', 'paused')),
  first_response_target_at timestamptz NOT NULL,
  first_response_responded_at timestamptz,
  resolution_target_at timestamptz NOT NULL,
  paused_at timestamptz,
  total_paused_minutes integer NOT NULL DEFAULT 0,
  at_risk_notified_at timestamptz,
  breached_at timestamptz,
  escalation_applied_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_sla_snapshots_workspace_state
  ON ticket_sla_snapshots (workspace_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  run_id text,
  recipient_type text NOT NULL CHECK (recipient_type IN ('agent', 'user')),
  recipient_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('inbox', 'email', 'agent_wake')),
  kind text NOT NULL CHECK (
    kind IN ('assignment', 'mention', 'close_requested', 'status_change', 'sla_at_risk', 'sla_breached')
  ),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_ticket_notifications_recipient
  ON ticket_notifications (recipient_type, recipient_id, created_at DESC);

COMMIT;
