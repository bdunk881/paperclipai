-- Migration 112: crash-resume reaper support (HEL-695).
--
-- A SIGKILL mid-_runSteps strands the run `status='running'` forever. The reaper
-- (src/engine/strandedRunReaper.ts) sweeps runs stuck `running` with a stale
-- `updated_at` (bumped per step, so it is the liveness signal) and re-enqueues a
-- replay-from-0 — safe because of the per-step idempotency landed in HEL-696.
--
--   * resume_attempts bounds resurrection: past a cap the reaper FAILS the run
--     instead of resurrecting a poison run forever.
--   * a partial index keeps the sweep's `status='running' AND updated_at < …`
--     scan cheap as the runs table grows.
BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS resume_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_runs_running_updated_at
  ON runs (updated_at)
  WHERE status = 'running';

COMMIT;
