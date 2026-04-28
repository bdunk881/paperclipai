BEGIN;

CREATE SCHEMA IF NOT EXISTS observability;

CREATE TABLE IF NOT EXISTS observability.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  metric_name text NOT NULL DEFAULT 'count',
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'unknown',
  duration_ms integer,
  cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS observability.events_default
  PARTITION OF observability.events DEFAULT;

CREATE INDEX IF NOT EXISTS idx_observability_events_workspace_time
  ON observability.events (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_observability_events_source_time
  ON observability.events (source, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_observability_events_type_time
  ON observability.events (event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION observability.ensure_event_partitions(
  start_date date DEFAULT CURRENT_DATE - 1,
  days_ahead integer DEFAULT 14
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  partition_day date;
  partition_name text;
BEGIN
  IF days_ahead < 0 THEN
    RAISE EXCEPTION 'days_ahead must be >= 0';
  END IF;

  FOR partition_day IN
    SELECT generate_series(start_date, start_date + days_ahead, interval '1 day')::date
  LOOP
    partition_name := format('events_%s', to_char(partition_day, 'YYYYMMDD'));

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS observability.%I PARTITION OF observability.events
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_day::timestamptz,
      (partition_day + 1)::timestamptz
    );
  END LOOP;
END;
$$;

SELECT observability.ensure_event_partitions(CURRENT_DATE - 1, 14);

CREATE TABLE IF NOT EXISTS observability.rollups_15m (
  bucket_start timestamptz NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  event_count bigint NOT NULL,
  error_count bigint NOT NULL,
  total_duration_ms bigint NOT NULL,
  total_cost_usd numeric(16, 6) NOT NULL,
  first_event_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, workspace_id, source, event_type, status)
);

CREATE INDEX IF NOT EXISTS idx_observability_rollups_15m_bucket
  ON observability.rollups_15m (bucket_start DESC);

CREATE TABLE IF NOT EXISTS observability.rollups_daily (
  bucket_date date NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  event_count bigint NOT NULL,
  error_count bigint NOT NULL,
  total_duration_ms bigint NOT NULL,
  total_cost_usd numeric(16, 6) NOT NULL,
  first_event_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_date, workspace_id, source, event_type, status)
);

CREATE INDEX IF NOT EXISTS idx_observability_rollups_daily_bucket
  ON observability.rollups_daily (bucket_date DESC);

CREATE OR REPLACE FUNCTION observability.refresh_rollups(
  lookback interval DEFAULT interval '2 days'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO observability.rollups_15m (
    bucket_start,
    workspace_id,
    source,
    event_type,
    status,
    event_count,
    error_count,
    total_duration_ms,
    total_cost_usd,
    first_event_at,
    last_event_at,
    updated_at
  )
  SELECT
    date_bin('15 minutes', occurred_at, '2000-01-01 00:00:00+00'::timestamptz) AS bucket_start,
    workspace_id,
    source,
    event_type,
    COALESCE(status, 'unknown') AS status,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE status IN ('error', 'failed')) AS error_count,
    COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms,
    COALESCE(SUM(cost_usd), 0)::numeric(16, 6) AS total_cost_usd,
    MIN(occurred_at) AS first_event_at,
    MAX(occurred_at) AS last_event_at,
    now() AS updated_at
  FROM observability.events
  WHERE occurred_at >= now() - lookback
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (bucket_start, workspace_id, source, event_type, status) DO UPDATE
  SET
    event_count = EXCLUDED.event_count,
    error_count = EXCLUDED.error_count,
    total_duration_ms = EXCLUDED.total_duration_ms,
    total_cost_usd = EXCLUDED.total_cost_usd,
    first_event_at = EXCLUDED.first_event_at,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  INSERT INTO observability.rollups_daily (
    bucket_date,
    workspace_id,
    source,
    event_type,
    status,
    event_count,
    error_count,
    total_duration_ms,
    total_cost_usd,
    first_event_at,
    last_event_at,
    updated_at
  )
  SELECT
    occurred_at::date AS bucket_date,
    workspace_id,
    source,
    event_type,
    COALESCE(status, 'unknown') AS status,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE status IN ('error', 'failed')) AS error_count,
    COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms,
    COALESCE(SUM(cost_usd), 0)::numeric(16, 6) AS total_cost_usd,
    MIN(occurred_at) AS first_event_at,
    MAX(occurred_at) AS last_event_at,
    now() AS updated_at
  FROM observability.events
  WHERE occurred_at >= now() - lookback
  GROUP BY 1, 2, 3, 4, 5
  ON CONFLICT (bucket_date, workspace_id, source, event_type, status) DO UPDATE
  SET
    event_count = EXCLUDED.event_count,
    error_count = EXCLUDED.error_count,
    total_duration_ms = EXCLUDED.total_duration_ms,
    total_cost_usd = EXCLUDED.total_cost_usd,
    first_event_at = EXCLUDED.first_event_at,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION observability.apply_retention(
  raw_retention_days integer DEFAULT 30,
  rollup_15m_retention_days integer DEFAULT 180,
  rollup_daily_retention_days integer DEFAULT 730
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  child_record record;
  partition_day date;
BEGIN
  IF raw_retention_days <= 0 THEN
    RAISE EXCEPTION 'raw_retention_days must be > 0';
  END IF;

  FOR child_record IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE parent_ns.nspname = 'observability'
      AND parent.relname = 'events'
      AND child_ns.nspname = 'observability'
      AND child.relname ~ '^events_[0-9]{8}$'
  LOOP
    partition_day := to_date(substring(child_record.partition_name FROM 'events_([0-9]{8})'), 'YYYYMMDD');
    IF partition_day < CURRENT_DATE - raw_retention_days THEN
      EXECUTE format('DROP TABLE IF EXISTS observability.%I', child_record.partition_name);
    END IF;
  END LOOP;

  DELETE FROM observability.rollups_15m
  WHERE bucket_start < now() - make_interval(days => rollup_15m_retention_days);

  DELETE FROM observability.rollups_daily
  WHERE bucket_date < CURRENT_DATE - rollup_daily_retention_days;
END;
$$;

COMMIT;
