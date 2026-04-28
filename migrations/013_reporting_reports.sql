CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  team_id UUID NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  period_start TIMESTAMPTZ NULL,
  period_end TIMESTAMPTZ NULL,
  template_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_reports_user_created_at
  ON generated_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_team_created_at
  ON generated_reports (team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_kind_created_at
  ON generated_reports (kind, created_at DESC);
