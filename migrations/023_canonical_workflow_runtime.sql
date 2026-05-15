-- Migration 022: Canonical workflow runtime tables (HEL-15)
--
-- Consolidates the legacy runtime persistence tables into the canonical noun
-- set:
--   workflow_imported_templates -> workflows + workflow_versions
--   workflow_runs               -> runs
--   workflow_step_results        -> step_results
--   workflow_queue_jobs          -> removed (queue transport is external)
--
-- New runs point at workflow_versions.id so every execution records the exact
-- DAG snapshot it used. Later workflow edits create new workflow_versions rows
-- instead of mutating old run history.

BEGIN;

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  external_template_id text,
  name text NOT NULL,
  latest_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_workspace_external_template
  ON workflows (workspace_id, external_template_id)
  WHERE workspace_id IS NOT NULL AND external_template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_global_external_template
  ON workflows (external_template_id)
  WHERE workspace_id IS NULL AND external_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON workflows (workspace_id);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  dag jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text,
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_created
  ON workflow_versions (workflow_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflows_latest_version_fk'
  ) THEN
    ALTER TABLE workflows
      ADD CONSTRAINT workflows_latest_version_fk
      FOREIGN KEY (latest_version_id) REFERENCES workflow_versions(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  name text NOT NULL,
  schedule_cron text,
  trigger_kind text NOT NULL DEFAULT 'manual'
    CHECK (trigger_kind IN ('manual', 'scheduled', 'webhook', 'event')),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routines_workspace_enabled
  ON routines (workspace_id, enabled);

CREATE INDEX IF NOT EXISTS idx_routines_agent
  ON routines (agent_id);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  status text NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'escalated', 'awaiting_approval')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  runtime_state_json jsonb,
  error text,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow_version
  ON runs (workflow_version_id);

CREATE INDEX IF NOT EXISTS idx_runs_routine
  ON runs (routine_id);

CREATE INDEX IF NOT EXISTS idx_runs_workspace_started
  ON runs (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs (status);

CREATE TABLE IF NOT EXISTS step_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  step_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure', 'skipped', 'running')),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_cents integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error text,
  agent_slot_results_json jsonb,
  cost_log_json jsonb,
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_step_results_run_ordinal
  ON step_results (run_id, ordinal);

DO $$
BEGIN
  IF to_regclass('public.workflow_imported_templates') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO workflows (workspace_id, external_template_id, name, created_at, updated_at)
      SELECT NULL::uuid, id, name, imported_at, imported_at
      FROM workflow_imported_templates
      ON CONFLICT (external_template_id)
      WHERE workspace_id IS NULL AND external_template_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    $sql$;

    EXECUTE $sql$
      INSERT INTO workflow_versions (workflow_id, version, dag, created_at, created_by_user_id)
      SELECT w.id, 1, t.template_definition, t.imported_at, t.imported_by
      FROM workflow_imported_templates t
      JOIN workflows w
        ON w.workspace_id IS NULL
       AND w.external_template_id = t.id
      ON CONFLICT (workflow_id, version)
      DO UPDATE SET dag = EXCLUDED.dag
    $sql$;

    EXECUTE $sql$
      UPDATE workflows w
      SET latest_version_id = v.id,
          updated_at = now()
      FROM workflow_versions v
      WHERE v.workflow_id = w.id
        AND v.version = 1
        AND w.workspace_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM workflow_imported_templates t
          WHERE t.id = w.external_template_id
        )
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('public.workflow_runs') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO workflows (workspace_id, external_template_id, name)
      SELECT DISTINCT NULL::uuid, template_id, template_name
      FROM workflow_runs
      ON CONFLICT (external_template_id)
      WHERE workspace_id IS NULL AND external_template_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    $sql$;

    EXECUTE $sql$
      INSERT INTO workflow_versions (workflow_id, version, dag)
      SELECT
        w.id,
        1,
        jsonb_build_object(
          'id', w.external_template_id,
          'name', w.name,
          'version', 1,
          'steps', '[]'::jsonb,
          'legacyRuntimeSnapshot', true
        )
      FROM workflows w
      WHERE w.workspace_id IS NULL
        AND w.external_template_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_versions v
          WHERE v.workflow_id = w.id
        )
      ON CONFLICT (workflow_id, version) DO NOTHING
    $sql$;

    EXECUTE $sql$
      UPDATE workflows w
      SET latest_version_id = v.id,
          updated_at = now()
      FROM workflow_versions v
      WHERE v.workflow_id = w.id
        AND w.latest_version_id IS NULL
    $sql$;

    EXECUTE $sql$
      INSERT INTO runs (
        id,
        workspace_id,
        routine_id,
        workflow_version_id,
        status,
        started_at,
        ended_at,
        input,
        output,
        runtime_state_json,
        error,
        user_id,
        created_at,
        updated_at
      )
      SELECT
        wr.id,
        NULL,
        NULL,
        w.latest_version_id,
        wr.status,
        wr.started_at,
        wr.completed_at,
        wr.input_json,
        wr.output_json,
        wr.runtime_state_json,
        wr.error,
        wr.user_id,
        wr.created_at,
        wr.updated_at
      FROM workflow_runs wr
      JOIN workflows w
        ON w.workspace_id IS NULL
       AND w.external_template_id = wr.template_id
      WHERE w.latest_version_id IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('public.workflow_step_results') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO step_results (
        run_id,
        step_id,
        step_name,
        status,
        output,
        cost_cents,
        duration_ms,
        error,
        agent_slot_results_json,
        cost_log_json,
        ordinal,
        created_at
      )
      SELECT
        run_id,
        step_id,
        step_name,
        status,
        output_json,
        CASE
          WHEN cost_log_json ->> 'estimatedCostUsd' ~ '^[0-9]+(\.[0-9]+)?$'
            THEN GREATEST(0, ROUND(((cost_log_json ->> 'estimatedCostUsd')::numeric) * 100)::integer)
          ELSE 0
        END,
        duration_ms,
        error,
        agent_slot_results_json,
        cost_log_json,
        ordinal,
        created_at
      FROM workflow_step_results
      ON CONFLICT (run_id, step_id, ordinal)
      DO UPDATE SET
        step_name = EXCLUDED.step_name,
        status = EXCLUDED.status,
        output = EXCLUDED.output,
        cost_cents = EXCLUDED.cost_cents,
        duration_ms = EXCLUDED.duration_ms,
        error = EXCLUDED.error,
        agent_slot_results_json = EXCLUDED.agent_slot_results_json,
        cost_log_json = EXCLUDED.cost_log_json
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('public.approval_requests') IS NOT NULL THEN
    ALTER TABLE approval_requests
      DROP CONSTRAINT IF EXISTS approval_requests_run_id_fkey;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'approval_requests_run_id_fkey'
    ) THEN
      ALTER TABLE approval_requests
        ADD CONSTRAINT approval_requests_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
    END IF;
  END IF;
END$$;

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflows_tenant_isolation ON workflows;
CREATE POLICY workflows_tenant_isolation
ON workflows
USING (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS workflow_versions_tenant_isolation ON workflow_versions;
CREATE POLICY workflow_versions_tenant_isolation
ON workflow_versions
USING (
  EXISTS (
    SELECT 1
    FROM workflows w
    WHERE w.id = workflow_versions.workflow_id
      AND (
        w.workspace_id IS NULL
        OR (
          app_current_workspace_id() IS NOT NULL
          AND w.workspace_id = app_current_workspace_id()
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM workflows w
    WHERE w.id = workflow_versions.workflow_id
      AND (
        w.workspace_id IS NULL
        OR (
          app_current_workspace_id() IS NOT NULL
          AND w.workspace_id = app_current_workspace_id()
        )
      )
  )
);

DROP POLICY IF EXISTS routines_tenant_isolation ON routines;
CREATE POLICY routines_tenant_isolation
ON routines
USING (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS runs_tenant_isolation ON runs;
CREATE POLICY runs_tenant_isolation
ON runs
USING (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS step_results_tenant_isolation ON step_results;
CREATE POLICY step_results_tenant_isolation
ON step_results
USING (
  EXISTS (
    SELECT 1
    FROM runs r
    WHERE r.id = step_results.run_id
      AND (
        r.workspace_id IS NULL
        OR (
          app_current_workspace_id() IS NOT NULL
          AND r.workspace_id = app_current_workspace_id()
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM runs r
    WHERE r.id = step_results.run_id
      AND (
        r.workspace_id IS NULL
        OR (
          app_current_workspace_id() IS NOT NULL
          AND r.workspace_id = app_current_workspace_id()
        )
      )
  )
);

DROP TABLE IF EXISTS workflow_queue_jobs CASCADE;
DROP TABLE IF EXISTS workflow_step_results CASCADE;
DROP TABLE IF EXISTS workflow_runs CASCADE;
DROP TABLE IF EXISTS workflow_imported_templates CASCADE;

COMMIT;
