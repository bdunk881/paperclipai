-- HEL infra follow-up: public status incident timeline
-- ------------------------------------------------------
-- Each row records a transition for a single component (e.g. the moment
-- "api" flipped from operational → degraded). The public status page polls
-- recent events to render the timeline; the events are written by the
-- status-computation pass when it detects a level change from the previous
-- snapshot. No events means no transitions = all clear.
--
-- Append-only at the application layer (no UPDATE/DELETE paths). The
-- public read endpoint sanitizes output so admin-only messages never
-- leak.

CREATE TABLE IF NOT EXISTS public_status_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id  text NOT NULL,
  component_name text NOT NULL,
  level         text NOT NULL CHECK (level IN ('operational','degraded','down','unknown')),
  message       text,
  recorded_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS public_status_events_recorded_idx
  ON public_status_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS public_status_events_component_recorded_idx
  ON public_status_events (component_id, recorded_at DESC);

COMMENT ON TABLE public_status_events IS
  'Transitions of public-status components — fuels the incident timeline on status.helloautoflow.com (HEL infra follow-up).';
