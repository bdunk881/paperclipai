-- Migration 111: eval_runs (HEL-776 / Ph4 — eval a workflow over a dataset).
--
-- An eval runs a workflow over a dataset of {input, expected} rows and measures
-- each output against its expected value. It is built on two prerequisites:
--   * the engine dry-run mode (HEL-786) — an eval is ALWAYS a dry run, so firing
--     a workflow N times never sends N real webhooks / CRM writes / emails; and
--   * batch triggering (HEL-702) — the N inputs fan out as one durable batch.
--
-- So an eval = a dry-run `run_batches` row (the fan-out) + the per-row EXPECTED
-- outputs, stored here as a jsonb array PARALLEL to the batch's `run_ids`
-- (index i ↔ run_ids[i] ↔ dataset row i). Scoring (`GET /api/evals/:id`) pairs
-- each run's output with `expected[i]` and compares — a pure, tested scorer
-- (src/engine/evalScorer.ts). No run/batch schema changes: the eval is a thin
-- layer that references the batch by id.
--
-- Workspace-isolated RLS + autoflow_api grant mirror migration 110 (run_batches).
BEGIN;

CREATE TABLE IF NOT EXISTS eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The dry-run batch that fanned the dataset out. CASCADE: deleting the batch
  -- (and its runs) deletes the eval that scored them.
  batch_id uuid NOT NULL REFERENCES run_batches(id) ON DELETE CASCADE,
  external_template_id text,
  name text NOT NULL,
  -- Per-row expected outputs, parallel to run_batches.run_ids (index i is the
  -- expected output for the run at run_ids[i]). A JSON array of objects.
  expected jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_workspace_created
  ON eval_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_batch
  ON eval_runs (batch_id);

-- Row-Level Security: workspace isolation. FORCE so the table owner is subject
-- too (migration 110/109 idiom: an unset workspace context must DENY).
ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eval_runs_workspace_isolation ON eval_runs;
CREATE POLICY eval_runs_workspace_isolation ON eval_runs
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id::text = app_current_workspace_id()::text)
  WITH CHECK (app_current_workspace_id() IS NOT NULL
             AND workspace_id::text = app_current_workspace_id()::text);

-- The non-superuser API role (migration 065, NOBYPASSRLS) needs explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eval_runs TO autoflow_api;

COMMIT;
