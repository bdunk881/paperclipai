-- HEL-108: Add 'queued' and 'canceled' to runs.status allowed values.
--
-- 'queued' is already written by the BullMQ enqueue path in app.ts (since HEL-106)
-- but was missing from the CHECK constraint. 'canceled' is needed by the new
-- DELETE /api/runs/:id/cancel endpoint.

ALTER TABLE public.runs
  DROP CONSTRAINT IF EXISTS runs_status_check;

ALTER TABLE public.runs
  ADD CONSTRAINT runs_status_check
    CHECK (status IN (
      'queued', 'pending', 'running', 'completed',
      'failed', 'escalated', 'awaiting_approval', 'canceled'
    ));
