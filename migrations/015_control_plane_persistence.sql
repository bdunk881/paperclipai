-- Migration 015: Persist Control Plane State to PostgreSQL (ALT-1984 / ALT-1915 Phase 2)
--
-- Replaces the in-memory Maps in src/controlPlane/controlPlaneStore.ts with
-- workspace-scoped, RLS-isolated tables so control plane state survives restarts
-- and cannot leak across tenants.
--
-- All tables follow the hardened RLS pattern from migration 014:
--   workspace_id = app_current_workspace_id() AND app_current_workspace_id() IS NOT NULL
-- so a missing session variable denies rows rather than silently returning empty.
--
-- Maps replaced by this migration:
--   companyRecords             -> provisioned_companies
--   teams                      -> control_plane_teams
--   agents                     -> control_plane_agents
--   executions                 -> control_plane_executions
--
-- Out of scope for Phase 2 (tracked separately):
--   companySecretBindings  -> Phase 3 (encrypted, audited)
--   tasks / heartbeats     -> Phase 4 (agent execution context)

BEGIN;

-- ============================================================
-- provisioned_companies
-- ============================================================
-- Replaces:
--   companies                 (ProvisionedCompanyRecord)
--   companyWorkspaces         (ProvisionedCompanyWorkspace, inlined)
--   companyIdempotencyIndex   (UNIQUE constraint below)

CREATE TABLE IF NOT EXISTS provisioned_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL,
  external_company_id text,

  -- Inline ProvisionedCompanyWorkspace fields (display-only, distinct from
  -- the tenant workspaces row referenced above).
  provisioned_workspace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provisioned_workspace_name text NOT NULL,
  provisioned_workspace_slug text NOT NULL,

  team_id uuid NOT NULL,

  idempotency_key text NOT NULL,

  budget_monthly_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (budget_monthly_usd >= 0),
  allocated_budget_monthly_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (allocated_budget_monthly_usd >= 0),
  remaining_budget_monthly_usd numeric(12,2) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotency is scoped per (workspace, user) to preserve the existing
  -- `${userId}:${idempotencyKey}` semantics without leaking globally.
  UNIQUE (workspace_id, user_id, idempotency_key),
  UNIQUE (provisioned_workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_provisioned_companies_workspace ON provisioned_companies (workspace_id);
CREATE INDEX IF NOT EXISTS idx_provisioned_companies_user ON provisioned_companies (workspace_id, user_id);

ALTER TABLE provisioned_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provisioned_companies_tenant_isolation ON provisioned_companies;
CREATE POLICY provisioned_companies_tenant_isolation
ON provisioned_companies
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_teams
-- ============================================================
-- Replaces: teams (ControlPlaneTeam)

CREATE TABLE IF NOT EXISTS control_plane_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  company_id uuid REFERENCES provisioned_companies(id) ON DELETE CASCADE,

  name text NOT NULL,
  description text,

  workflow_template_id text,
  workflow_template_name text,

  deployment_mode text NOT NULL DEFAULT 'workflow_runtime'
    CHECK (deployment_mode IN ('workflow_runtime', 'continuous_agents')),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'stopped')),
  paused_by_company_lifecycle boolean NOT NULL DEFAULT false,
  restart_count integer NOT NULL DEFAULT 0 CHECK (restart_count >= 0),

  budget_monthly_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (budget_monthly_usd >= 0),
  tool_budget_ceilings jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_thresholds jsonb NOT NULL DEFAULT '[0.8, 0.9, 1]'::jsonb,
  orchestration_enabled boolean NOT NULL DEFAULT true,

  last_heartbeat_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_teams_workspace ON control_plane_teams (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_teams_user ON control_plane_teams (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_teams_company ON control_plane_teams (company_id);

ALTER TABLE control_plane_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_teams_tenant_isolation ON control_plane_teams;
CREATE POLICY control_plane_teams_tenant_isolation
ON control_plane_teams
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Now that control_plane_teams exists, add the deferred FK from
-- provisioned_companies.team_id back to it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provisioned_companies_team_fk'
  ) THEN
    ALTER TABLE provisioned_companies
      ADD CONSTRAINT provisioned_companies_team_fk
      FOREIGN KEY (team_id) REFERENCES control_plane_teams(id) ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

-- ============================================================
-- control_plane_agents
-- ============================================================
-- Replaces: agents (ControlPlaneAgent)

CREATE TABLE IF NOT EXISTS control_plane_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,

  name text NOT NULL,
  role_key text NOT NULL,
  workflow_step_id text,
  workflow_step_kind text,

  model text,
  instructions text,

  budget_monthly_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (budget_monthly_usd >= 0),

  reporting_to_agent_id uuid REFERENCES control_plane_agents(id) ON DELETE SET NULL,

  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule jsonb NOT NULL DEFAULT '{"type":"manual"}'::jsonb,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'terminated')),
  paused_by_company_lifecycle boolean NOT NULL DEFAULT false,

  current_execution_id uuid,
  last_heartbeat_at timestamptz,
  last_heartbeat_status text
    CHECK (last_heartbeat_status IS NULL OR last_heartbeat_status IN ('queued', 'running', 'blocked', 'completed')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_agents_workspace ON control_plane_agents (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_agents_team ON control_plane_agents (team_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_agents_user ON control_plane_agents (workspace_id, user_id);

ALTER TABLE control_plane_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_agents_tenant_isolation ON control_plane_agents;
CREATE POLICY control_plane_agents_tenant_isolation
ON control_plane_agents
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_executions
-- ============================================================
-- Replaces: executions (ControlPlaneExecution)

CREATE TABLE IF NOT EXISTS control_plane_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES control_plane_agents(id) ON DELETE CASCADE,

  source_run_id text NOT NULL,
  source_workflow_step_id text NOT NULL,
  source_workflow_step_name text NOT NULL,
  task_id uuid,

  status text NOT NULL
    CHECK (status IN ('queued', 'running', 'blocked', 'completed', 'failed', 'stopped')),
  applied_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb,

  summary text,
  cost_usd numeric(12,4),

  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  restart_count integer NOT NULL DEFAULT 0 CHECK (restart_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_control_plane_executions_workspace ON control_plane_executions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_executions_team ON control_plane_executions (team_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_executions_agent ON control_plane_executions (agent_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_executions_user_requested
  ON control_plane_executions (workspace_id, user_id, requested_at);

ALTER TABLE control_plane_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_executions_tenant_isolation ON control_plane_executions;
CREATE POLICY control_plane_executions_tenant_isolation
ON control_plane_executions
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Soft FK from agents.current_execution_id back to executions; deferred so
-- agent and execution rows can be inserted in either order inside the same
-- transaction.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'control_plane_agents_current_execution_fk'
  ) THEN
    ALTER TABLE control_plane_agents
      ADD CONSTRAINT control_plane_agents_current_execution_fk
      FOREIGN KEY (current_execution_id) REFERENCES control_plane_executions(id) ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

COMMIT;
