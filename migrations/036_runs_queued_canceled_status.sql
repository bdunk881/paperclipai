-- Migration 036: Add 'queued' and 'canceled' to runs.status allowed values (HEL-108)
--
-- 'queued' is already written by the BullMQ enqueue path in app.ts (since HEL-106)
-- but was missing from the CHECK constraint. 'canceled' is needed by the new
-- DELETE /api/runs/:id/cancel endpoint.

BEGIN;

ALTER TABLE runs
  DROP CONSTRAINT IF EXISTS runs_status_check;

ALTER TABLE runs
  ADD CONSTRAINT runs_status_check
    CHECK (status IN (
      'queued', 'pending', 'running', 'completed',
      'failed', 'escalated', 'awaiting_approval', 'canceled'
    ));

COMMIT;
