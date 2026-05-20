-- Migration 055: agents.metadata for provisioning context (mission scope on Team page)
--
-- Hiring-plan confirm stores missionId + hiringPlanId so the dashboard can
-- filter the org chart to a single mission roster. Legacy agents keep {}.

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
