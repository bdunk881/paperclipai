-- prompt_routines.created_by — used by the scheduler so the fired ticket
-- has a real workspace member as `creator_id`. Nullable for backfill.
ALTER TABLE prompt_routines
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- Index helps the scheduler's "next due" query bail early on paused/ended rows.
CREATE INDEX IF NOT EXISTS idx_prompt_routines_active_due
  ON prompt_routines (workspace_id, last_fired_at)
  WHERE status = 'active';
