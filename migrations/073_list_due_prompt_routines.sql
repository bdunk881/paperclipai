-- list_due_prompt_routines — SECURITY DEFINER helper for the
-- promptRoutineCoordinator. The coordinator runs without a workspace
-- context, so it can't read prompt_routines under RLS. This function
-- returns just the rows that are due to fire right now, grouped by
-- workspace so the coordinator can scope the follow-up writes
-- (ticketStore.create + activity_events) per workspace.
--
-- "Due" means:
--   - status = 'active'
--   - now() between starts_at and (ends_at OR forever)
--   - current local day-of-week is in days_of_week
--   - local time has passed time_of_day for today
--   - last_fired_at is either NULL or on a previous local day
--
-- Returns the same row shape the application code reads, so the
-- coordinator can map directly to the existing TS interface.

BEGIN;

CREATE OR REPLACE FUNCTION list_due_prompt_routines()
RETURNS TABLE (
  id              uuid,
  workspace_id    uuid,
  name            text,
  prompt          text,
  mission_id      uuid,
  agent_id        uuid,
  days_of_week    int[],
  time_of_day     time,
  timezone        text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          text,
  last_fired_at   timestamptz,
  created_by      uuid,
  created_at      timestamptz,
  updated_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    r.id,
    r.workspace_id,
    r.name,
    r.prompt,
    r.mission_id,
    r.agent_id,
    r.days_of_week,
    r.time_of_day,
    r.timezone,
    r.starts_at,
    r.ends_at,
    r.status,
    r.last_fired_at,
    r.created_by,
    r.created_at,
    r.updated_at
  FROM prompt_routines r
  WHERE r.status = 'active'
    AND r.starts_at <= now()
    AND (r.ends_at IS NULL OR r.ends_at > now())
    AND (
      EXTRACT(DOW FROM (now() AT TIME ZONE r.timezone))::int = ANY(r.days_of_week)
    )
    AND (now() AT TIME ZONE r.timezone)::time >= r.time_of_day
    AND (
      r.last_fired_at IS NULL
      OR (r.last_fired_at AT TIME ZONE r.timezone)::date
         < (now() AT TIME ZONE r.timezone)::date
    )
$$;

ALTER FUNCTION list_due_prompt_routines() SET search_path = public, pg_catalog;

COMMENT ON FUNCTION list_due_prompt_routines() IS
  'HEL-231: SECURITY DEFINER. Returns prompt_routines rows that are due to fire now, evaluating the schedule in each routine''s own timezone.';

-- Also: a tiny helper that flips routines whose ends_at has elapsed.
-- The coordinator calls it once per sweep so terminal routines don't
-- linger as "active".
CREATE OR REPLACE FUNCTION mark_ended_prompt_routines()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH ended AS (
    UPDATE prompt_routines
       SET status = 'ended'
     WHERE status = 'active'
       AND ends_at IS NOT NULL
       AND ends_at <= now()
    RETURNING id
  )
  SELECT COUNT(*)::int FROM ended
$$;

ALTER FUNCTION mark_ended_prompt_routines() SET search_path = public, pg_catalog;

COMMENT ON FUNCTION mark_ended_prompt_routines() IS
  'HEL-231: SECURITY DEFINER. Flips status=active to status=ended for routines whose ends_at has elapsed. Returns the count flipped.';

COMMIT;
