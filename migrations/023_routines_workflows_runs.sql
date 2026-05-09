-- Migration 023: Canonical workflows, workflow_versions, routines, runs, step_results (HEL-15)
--
-- Establishes the schema-level canonical model for workflow execution:
--   workspace -> workflows -> workflow_versions
--                          \-> routines (scheduled/triggered) -> runs -> step_results
--
-- Coexists with the engine's existing `workflow_runs` + `workflow_step_results`
-- tables (002_workflow_runtime_persistence.sql). The engine continues to write
-- to those for now; migration of code paths to the canonical model is a follow-up.

BEGIN;

-- ============================================================
-- workflows (canonical)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- latest_version_id is FK'd later (chicken-and-egg with workflow_versions).
  latest_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- workflow_versions (canonical DAG storage, immutable per version)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  dag jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  UNIQUE (workflow_id, version)
);

-- Now we can add the FK on workflows.latest_version_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_name = 'workflows'
       AND constraint_name = 'workflows_latest_version_fk'
  ) THEN
    ALTER TABLE workflows
      ADD CONSTRAINT workflows_latest_version_fk
      FOREIGN KEY (latest_version_id) REFERENCES workflow_versions(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ============================================================
-- routines (scheduled/triggered workflow execution wrapper)
-- ============================================================
CREATE TABLE IF NOT EXISTS routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name text NOT NULL,
  schedule_cron text,
  trigger_kind text NOT NULL DEFAULT 'manual'
    CHECK (trigger_kind IN ('manual', 'cron', 'webhook', 'event')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- runs (canonical — one execution of a workflow version)
-- ============================================================
-- Coexists with workflow_runs (engine runtime). Future ticket migrates
-- engine code paths to write canonical runs.
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval')),
  started_at timestamptz,
  ended_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- step_results (canonical — output of one node in a run)
-- ============================================================
CREATE TABLE IF NOT EXISTS step_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  status text NOT NULL
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  output jsonb,
  cost_cents integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_id, ordinal)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_workflows_workspace_id
  ON workflows (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id
  ON workflow_versions (workflow_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_routines_workspace_id
  ON routines (workspace_id);
CREATE INDEX IF NOT EXISTS idx_routines_agent_id
  ON routines (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routines_enabled
  ON routines (workspace_id, enabled);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_id
  ON runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_routine_id
  ON runs (routine_id, created_at DESC) WHERE routine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_step_results_run_id
  ON step_results (run_id, ordinal);

-- ============================================================
-- RLS — workspace isolation on every workspace-scoped table.
-- Child tables join through their parent's workspace where the column
-- isn't directly present.
-- ============================================================
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines FORCE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
ALTER TABLE step_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflows_tenant_isolation ON workflows;
CREATE POLICY workflows_tenant_isolation
ON workflows
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

DROP POLICY IF EXISTS workflow_versions_tenant_isolation ON workflow_versions;
CREATE POLICY workflow_versions_tenant_isolation
ON workflow_versions
USING (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM workflows
     WHERE workflows.id = workflow_versions.workflow_id
       AND workflows.workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM workflows
     WHERE workflows.id = workflow_versions.workflow_id
       AND workflows.workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS routines_tenant_isolation ON routines;
CREATE POLICY routines_tenant_isolation
ON routines
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

DROP POLICY IF EXISTS runs_tenant_isolation ON runs;
CREATE POLICY runs_tenant_isolation
ON runs
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

DROP POLICY IF EXISTS step_results_tenant_isolation ON step_results;
CREATE POLICY step_results_tenant_isolation
ON step_results
USING (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM runs
     WHERE runs.id = step_results.run_id
       AND runs.workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM runs
     WHERE runs.id = step_results.run_id
       AND runs.workspace_id = app_current_workspace_id()
  )
);

COMMIT;
