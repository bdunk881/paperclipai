-- Migration 053: prompt-backed routines + runs (HEL-174).
--
-- Before this migration: every routine MUST be backed by a workflow
-- (`routines.workflow_id NOT NULL`), and every run MUST be backed by a
-- workflow version (`runs.workflow_version_id NOT NULL`). That forces
-- the "I just want to schedule an agent to do something" flow through
-- the workflow builder.
--
-- After this migration: routines and runs can be prompt-backed
-- (`prompt` column with no workflow/workflow_version), executed by the
-- shared `executeAgentPrompt()` primitive. Existing DAG-backed routines
-- and runs continue to work unchanged.
--
-- A CHECK constraint on each table enforces "exactly one execution mode."
-- New column `runs.source_ticket_id` links assignment-triggered runs
-- back to the originating ticket so the worker can document its
-- actions as ticket updates.

BEGIN;

-- 1. routines: allow workflow_id NULL when prompt is set.
ALTER TABLE routines
  ALTER COLUMN workflow_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prompt text,
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS llm_tier text
    CHECK (llm_tier IS NULL OR llm_tier IN ('lite', 'standard', 'power'));

ALTER TABLE routines DROP CONSTRAINT IF EXISTS routines_exactly_one_execution;
ALTER TABLE routines
  ADD CONSTRAINT routines_exactly_one_execution
    CHECK ((workflow_id IS NOT NULL) <> (prompt IS NOT NULL));

-- 2. runs: allow workflow_version_id NULL when prompt is set, link to
--    source ticket.
ALTER TABLE runs
  ALTER COLUMN workflow_version_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prompt text,
  ADD COLUMN IF NOT EXISTS source_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_exactly_one_execution;
ALTER TABLE runs
  ADD CONSTRAINT runs_exactly_one_execution
    CHECK ((workflow_version_id IS NOT NULL) <> (prompt IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_runs_source_ticket
  ON runs (source_ticket_id)
  WHERE source_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routines_prompt_backed
  ON routines (workspace_id, enabled)
  WHERE prompt IS NOT NULL;

COMMIT;
