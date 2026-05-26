-- Prompt routines — a lightweight scheduled-prompt surface that lives
-- alongside Studio workflows on the Routines page.
--
-- A prompt routine is just: "send this prompt to this agent (in this
-- mission) on this schedule." It fires at `time_of_day` in `timezone`
-- on each day in `days_of_week`, between `starts_at` and `ends_at`.
-- Each fire creates an assignment for the bound agent and posts an
-- activity event so it shows up on /assignments and /agents/activity.
--
-- Endpoints: src/promptRoutines/promptRoutineRoutes.ts.

CREATE TABLE IF NOT EXISTS prompt_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt text NOT NULL,
  mission_id uuid REFERENCES missions(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  -- Schedule. days_of_week is 0..6 with 0 = Sunday (matches JS Date).
  days_of_week int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::int[],
  time_of_day time NOT NULL DEFAULT '09:00',
  timezone text NOT NULL DEFAULT 'UTC',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'ended')),
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    array_length(days_of_week, 1) >= 1
    AND array_length(days_of_week, 1) <= 7
  ),
  CHECK (
    ends_at IS NULL OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_prompt_routines_workspace_status
  ON prompt_routines (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prompt_routines_mission
  ON prompt_routines (mission_id)
  WHERE mission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_routines_agent
  ON prompt_routines (agent_id)
  WHERE agent_id IS NOT NULL;

ALTER TABLE prompt_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_routines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prompt_routines_tenant_isolation ON prompt_routines;
CREATE POLICY prompt_routines_tenant_isolation
ON prompt_routines
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- updated_at trigger so PATCH calls reflect modification time.
CREATE OR REPLACE FUNCTION prompt_routines_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prompt_routines_set_updated_at ON prompt_routines;
CREATE TRIGGER prompt_routines_set_updated_at
  BEFORE UPDATE ON prompt_routines
  FOR EACH ROW EXECUTE FUNCTION prompt_routines_touch_updated_at();
