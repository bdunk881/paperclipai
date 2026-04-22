BEGIN;

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS runtime_state_json jsonb;

COMMIT;
