-- HEL Infra Dashboard PR #2: scheduled-job run history
-- ---------------------------------------------------
-- Lightweight table populated by each scheduled job (openrouterHealth,
-- creditExpiration, creditAnomalyDetector, runtimeRetention) so the admin
-- console's Compute tab can render the "last 10 runs" panel without
-- scraping logs. Append-only at the writer-role level; readable only by
-- platform admins via the existing requirePlatformAdmin middleware.

CREATE TABLE IF NOT EXISTS admin_infra_job_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      text NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  outcome       text NOT NULL CHECK (outcome IN ('success', 'failure', 'partial', 'skipped')),
  message       text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_infra_job_runs_job_started_idx
  ON admin_infra_job_runs (job_name, started_at DESC);

-- Retention guardrail: the page only needs the most recent ~10 per job, but
-- we keep 30 days for audit / diagnostics. A nightly housekeeping job
-- (separate PR) can trim by created_at.
COMMENT ON TABLE admin_infra_job_runs IS
  'Append-only run history for scheduled jobs (HEL infra dashboard PR #2). Read by /api/admin-console/infra/compute.';
