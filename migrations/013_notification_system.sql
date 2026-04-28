CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'sms')),
  kind text NOT NULL CHECK (kind IN ('approvals', 'milestones', 'kpi_alerts', 'budget_alerts', 'kill_switch')),
  cadence text NOT NULL CHECK (cadence IN ('off', 'immediate', 'daily', 'weekly')),
  enabled boolean NOT NULL DEFAULT true,
  muted_until timestamptz,
  last_digest_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel, kind)
);

CREATE TABLE IF NOT EXISTS notification_channel_configs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'sms')),
  owner_user_id text NOT NULL,
  connection_id text,
  enabled boolean NOT NULL DEFAULT true,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('approvals', 'milestones', 'kpi_alerts', 'budget_alerts', 'kill_switch')),
  title text NOT NULL,
  summary text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'sms')),
  cadence text NOT NULL CHECK (cadence IN ('immediate', 'daily', 'weekly')),
  delivered_at timestamptz,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_workspace_kind_time
  ON notification_events (workspace_id, kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_workspace_channel_cadence
  ON notification_deliveries (workspace_id, channel, cadence, created_at DESC);
