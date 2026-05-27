-- Migration 066: GDPR data export + right-to-erasure job queue.
--
-- Both export and erasure are async (heavy I/O, want them off the request
-- thread). The worker in src/adminConsole/dataHygieneWorker.ts picks up
-- pending rows, builds the export (or executes the deletion), and updates the
-- row with the artifact URL (export) or completion timestamp (erasure).
--
-- For exports, artifact_url is a 7-day-signed object-storage URL the user
-- receives via email. For erasure, hard_delete_at is the schedule for the
-- final hard delete (default +30 days from soft-delete).

BEGIN;

CREATE TABLE IF NOT EXISTS data_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  requested_by_admin_id text NOT NULL,

  kind text NOT NULL CHECK (kind IN ('export', 'erasure', 'anonymize')),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

  reason text NOT NULL DEFAULT '',

  -- Export-specific: signed URL to the artifact, plus its expiry.
  artifact_url text NULL,
  artifact_expires_at timestamptz NULL,

  -- Erasure-specific: when the hard delete should run.
  hard_delete_at timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  failure_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_data_export_jobs_pending
  ON data_export_jobs (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_data_export_jobs_user_at
  ON data_export_jobs (user_id, created_at DESC);

ALTER TABLE data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_export_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_export_jobs_admin_only ON data_export_jobs;
CREATE POLICY data_export_jobs_admin_only
  ON data_export_jobs
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
