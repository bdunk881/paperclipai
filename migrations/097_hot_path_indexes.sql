-- HEL-561: hot-path indexes for run + episode list queries.
-- See FEATURE_REVIEW.md §B5. Additive + idempotent (IF NOT EXISTS); applied at
-- boot by src/db/sqlMigrations.ts. Plain CREATE INDEX (not CONCURRENTLY) because
-- migrations run inside a transaction and data volumes are small.

-- "pending/active runs for my workspace" filtered status in a second pass —
-- idx_runs_status (023) is on `status` alone. This composite serves the
-- workspace + status filter from one index (e.g. the dashboard runs list).
CREATE INDEX IF NOT EXISTS idx_runs_workspace_status
  ON runs (workspace_id, status);

-- "episodes for run X" was a sequential scan — agent_episodes.run_id (034) had
-- no index. Partial because run_id is nullable (reflection episodes have none),
-- which keeps the index small.
CREATE INDEX IF NOT EXISTS idx_agent_episodes_run
  ON agent_episodes (run_id)
  WHERE run_id IS NOT NULL;
