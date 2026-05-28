-- HEL infra follow-up: cost alerting thresholds
-- ------------------------------------------------
-- Admins configure per-metric ceilings on the Infra > Cost tab. The
-- routes layer computes "is this threshold breached?" from the most
-- recent spend reads and surfaces a banner; future work can deliver
-- breaches via the Ask-an-Agent webhook system.
--
-- One row per (metric, bucket) so admins can set, for example, a
-- $50/day projection ceiling on the openrouter `projected_daily` bucket
-- and a separate $1500/month ceiling on the same surface. Disabling
-- happens via the `disabled_at` column rather than DELETE so we keep
-- history of who set what when.

CREATE TABLE IF NOT EXISTS admin_cost_thresholds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric           text NOT NULL CHECK (metric IN ('openrouter')),
  bucket           text NOT NULL CHECK (
    bucket IN ('trailing_24h', 'trailing_7d', 'trailing_30d', 'projected_daily', 'projected_monthly', 'balance_runway_days')
  ),
  ceiling_value    numeric(12,2) NOT NULL CHECK (ceiling_value >= 0),
  /* Free-text label so admins can remember why they set it (e.g. "Q3 budget
     guardrail" or "panic if we trip 2x last month"). */
  note             text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  disabled_at      timestamptz,
  CONSTRAINT admin_cost_thresholds_unique_active
    EXCLUDE (metric WITH =, bucket WITH =) WHERE (disabled_at IS NULL)
);

CREATE INDEX IF NOT EXISTS admin_cost_thresholds_active_idx
  ON admin_cost_thresholds (metric, bucket)
  WHERE disabled_at IS NULL;

COMMENT ON TABLE admin_cost_thresholds IS
  'Admin-defined ceilings on cost metrics for the Infra > Cost tab (HEL infra follow-up).';
