BEGIN;

CREATE TABLE IF NOT EXISTS observability_events (
  event_id text PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE,
  user_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('issue', 'run', 'heartbeat', 'budget', 'alert')),
  type text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  actor_label text,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  subject_label text,
  subject_parent_type text,
  subject_parent_id text,
  summary text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observability_events_user_sequence
  ON observability_events (user_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_observability_events_user_category_sequence
  ON observability_events (user_id, category, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_observability_events_subject
  ON observability_events (subject_type, subject_id, sequence DESC);

COMMIT;
