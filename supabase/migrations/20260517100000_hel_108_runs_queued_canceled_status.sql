-- HEL-108: Add 'queued' and 'canceled' to runs.status allowed values.
--
-- 'queued' is already written by the BullMQ enqueue path in app.ts (since HEL-106)
-- but was missing from the CHECK constraint. 'canceled' is needed by the new
-- DELETE /api/runs/:id/cancel endpoint.
--
-- Wrapped in DO $$ so this is a no-op when public.runs does not yet exist
-- (e.g. in Supabase preview branches that are missing the base table migration).

DO $$
BEGIN
  IF to_regclass('public.runs') IS NOT NULL THEN
    ALTER TABLE public.runs
      DROP CONSTRAINT IF EXISTS runs_status_check;

    ALTER TABLE public.runs
      ADD CONSTRAINT runs_status_check
        CHECK (status IN (
          'queued', 'pending', 'running', 'completed',
          'failed', 'escalated', 'awaiting_approval', 'canceled'
        ));
  END IF;
END
$$;
