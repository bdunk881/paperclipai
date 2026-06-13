-- Migration 110: run_batches (HEL-702 / Ph3 — durable batch triggering).
--
-- A batch is N durable workflow runs fanned out over N inputs and created +
-- enqueued together (see src/engine/batchTrigger.ts). Each run is a normal row
-- in `runs` (durable: BullMQ-queued + Postgres-persisted); this table only
-- *groups* them — it holds the run ids so a caller can track the set with one
-- handle. Batch status is a single GROUP BY over `runs.status` for `run_ids`
-- (src/engine/runStore.ts listByIds), so there is NO change to the hot
-- `runs` / `runStore.create` path and no `batch_id` column on `runs`.
--
-- The eval (HEL-776) fans a workflow over a dataset in dry-run mode (HEL-786)
-- via this batch API, then scores each run's output once the batch is `done`.
--
-- Workspace-isolated RLS mirrors migration 109 (composio_trigger_instances):
-- FORCE so the owner is subject too, and an explicit grant for the
-- non-superuser API role (migration 065, NOBYPASSRLS).
BEGIN;

CREATE TABLE IF NOT EXISTS run_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The workflow version every run in the batch executed (all share one
  -- template). Nullable + SET NULL: the runs already join to their version, so
  -- losing this denormalized convenience pointer never orphans a batch.
  workflow_version_id uuid REFERENCES workflow_versions(id) ON DELETE SET NULL,
  external_template_id text,
  name text NOT NULL,
  total integer NOT NULL CHECK (total >= 0),
  -- The ids of the runs in this batch (each a row in `runs`). Bounded by the
  -- API's MAX_BATCH_INPUTS cap, so the array stays small.
  run_ids uuid[] NOT NULL DEFAULT '{}',
  -- True when the batch was triggered as a dry run (HEL-786): every run's
  -- config carries __dryRun, so side-effecting steps no-op.
  dry_run boolean NOT NULL DEFAULT false,
  created_by_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_batches_workspace_created
  ON run_batches (workspace_id, created_at DESC);

-- Row-Level Security: workspace isolation. FORCE so the table owner is subject
-- too (migration 108/109 idiom: an unset workspace context must DENY, not
-- silently return rows).
ALTER TABLE run_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_batches_workspace_isolation ON run_batches;
CREATE POLICY run_batches_workspace_isolation ON run_batches
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id::text = app_current_workspace_id()::text)
  WITH CHECK (app_current_workspace_id() IS NOT NULL
             AND workspace_id::text = app_current_workspace_id()::text);

-- The non-superuser API role (migration 065, NOBYPASSRLS) needs explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_batches TO autoflow_api;

COMMIT;
