-- Migration 054: add 'cancelling' to runs.status allowed values (HEL-175).
--
-- Before this migration: `DELETE /api/runs/:id/cancel` (added in HEL-108)
-- only accepts runs whose status is 'queued' or 'pending'. Runs that are
-- already executing in the worker can't be cancelled — an agent stuck in a
-- tool loop burns budget until it hits `max_tokens`.
--
-- After this migration: the cancel route also accepts 'running' runs.
-- It flips the status to 'cancelling' (not 'canceled') so the worker can
-- check the flag at the next safe checkpoint and stop cleanly. The worker
-- transitions 'cancelling' → 'canceled' after a successful bail.
--
-- 'canceled' is preserved from migration 036; this migration only ADDS the
-- new intermediate state.

BEGIN;

ALTER TABLE runs
  DROP CONSTRAINT IF EXISTS runs_status_check;

ALTER TABLE runs
  ADD CONSTRAINT runs_status_check
    CHECK (status IN (
      'queued', 'pending', 'running', 'completed',
      'failed', 'escalated', 'awaiting_approval',
      'canceled', 'cancelling'
    ));

COMMIT;
