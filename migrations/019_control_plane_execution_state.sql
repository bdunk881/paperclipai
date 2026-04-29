-- Migration 019: Persist control-plane execution state (ALT-2042 / ALT-1915 Phase 4)
--
-- Replaces the in-memory `tasks`, `heartbeats`, `spendEntries`, and
-- `budgetAlerts` Maps in src/controlPlane/controlPlaneStore.ts with four
-- workspace-scoped, RLS-isolated tables. Same hardened isolation pattern as
-- migrations 014/015/016/017:
--   workspace_id = app_current_workspace_id() AND app_current_workspace_id() IS NOT NULL
-- so a missing session variable denies rows rather than silently returning empty.
-- ENABLE + FORCE ROW LEVEL SECURITY so the table owner cannot bypass policies.
--
-- Maps replaced by this migration:
--   tasks         -> control_plane_tasks
--   heartbeats    -> control_plane_heartbeats
--   spendEntries  -> control_plane_spend_entries
--   budgetAlerts  -> control_plane_budget_alerts
--
-- Schema mirrors src/controlPlane/types.ts:
--   ControlPlaneTask, AgentHeartbeatRecord, ControlPlaneSpendEntry,
--   ControlPlaneBudgetAlert.

BEGIN;

-- ============================================================
-- control_plane_tasks
-- ============================================================
-- Replaces: tasks (ControlPlaneTask)
--
-- A task is owned by a (workspace, user) and bound to a control-plane team.
-- Optional FKs: assignedAgentId -> control_plane_agents, source execution.
-- audit_trail stores the append-only event ledger as jsonb (small per task,
-- bounded by lifecycle events). metadata is opaque jsonb.

CREATE TABLE IF NOT EXISTS control_plane_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  assigned_agent_id uuid REFERENCES control_plane_agents(id) ON DELETE SET NULL,
  execution_id uuid REFERENCES control_plane_executions(id) ON DELETE SET NULL,

  title text NOT NULL,
  description text,
  source_run_id text,
  source_workflow_step_id text,

  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),

  checked_out_by text,
  checked_out_at timestamptz,

  audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_tasks_workspace
  ON control_plane_tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_tasks_user_team
  ON control_plane_tasks (workspace_id, user_id, team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_control_plane_tasks_agent
  ON control_plane_tasks (assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_tasks_execution
  ON control_plane_tasks (execution_id);

ALTER TABLE control_plane_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_tasks_tenant_isolation ON control_plane_tasks;
CREATE POLICY control_plane_tasks_tenant_isolation
ON control_plane_tasks
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_heartbeats
-- ============================================================
-- Replaces: heartbeats (AgentHeartbeatRecord)
--
-- A heartbeat is the durable record of an agent execution slice. It is
-- workspace + user scoped via FKs to control_plane_agents/executions, both of
-- which are themselves workspace-isolated. created_task_ids is jsonb array of
-- task ids surfaced from this heartbeat (matches AgentHeartbeatRecord shape).

CREATE TABLE IF NOT EXISTS control_plane_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES control_plane_agents(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES control_plane_executions(id) ON DELETE SET NULL,

  status text NOT NULL
    CHECK (status IN ('queued', 'running', 'blocked', 'completed')),

  summary text,
  cost_usd numeric(12,4),
  created_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_control_plane_heartbeats_workspace
  ON control_plane_heartbeats (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_heartbeats_agent_started
  ON control_plane_heartbeats (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_heartbeats_team_started
  ON control_plane_heartbeats (team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_heartbeats_execution
  ON control_plane_heartbeats (execution_id);

ALTER TABLE control_plane_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_heartbeats FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_heartbeats_tenant_isolation ON control_plane_heartbeats;
CREATE POLICY control_plane_heartbeats_tenant_isolation
ON control_plane_heartbeats
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_spend_entries
-- ============================================================
-- Replaces: spendEntries (ControlPlaneSpendEntry)
--
-- Per-event spend ledger. Append-mostly in practice but we keep DELETE/UPDATE
-- open here to preserve operational flexibility (correcting a misattributed
-- entry, etc); the secret_audit table is the only true append-only ledger.

CREATE TABLE IF NOT EXISTS control_plane_spend_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES control_plane_agents(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES control_plane_executions(id) ON DELETE SET NULL,

  category text NOT NULL
    CHECK (category IN ('llm', 'tool', 'api', 'compute', 'ad_spend', 'third_party')),
  cost_usd numeric(12,4) NOT NULL CHECK (cost_usd >= 0),

  model text,
  provider text,
  tool_name text,
  metadata jsonb,

  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_spend_workspace
  ON control_plane_spend_entries (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_spend_team_recorded
  ON control_plane_spend_entries (team_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_spend_agent_recorded
  ON control_plane_spend_entries (agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_plane_spend_execution
  ON control_plane_spend_entries (execution_id);

ALTER TABLE control_plane_spend_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_spend_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_spend_entries_tenant_isolation ON control_plane_spend_entries;
CREATE POLICY control_plane_spend_entries_tenant_isolation
ON control_plane_spend_entries
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- control_plane_budget_alerts
-- ============================================================
-- Replaces: budgetAlerts (ControlPlaneBudgetAlert)
--
-- Dedupe key matches the runtime semantics in controlPlaneStore: a single
-- alert per (team, agent?, tool?, scope, threshold) so we do not emit
-- duplicate alerts for the same crossing during a billing period. agent_id
-- and tool_name are nullable because budget scope is one of team / agent /
-- tool. We use a partial unique index so NULLs in agent_id / tool_name still
-- collapse into a single row per scope/threshold combination.

CREATE TABLE IF NOT EXISTS control_plane_budget_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES control_plane_agents(id) ON DELETE CASCADE,
  tool_name text,

  scope text NOT NULL
    CHECK (scope IN ('team', 'agent', 'tool')),
  threshold numeric(6,4) NOT NULL CHECK (threshold > 0 AND threshold <= 2),
  budget_usd numeric(12,2) NOT NULL CHECK (budget_usd >= 0),
  spent_usd numeric(12,2) NOT NULL CHECK (spent_usd >= 0),

  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_budget_alerts_workspace
  ON control_plane_budget_alerts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_control_plane_budget_alerts_team_recorded
  ON control_plane_budget_alerts (team_id, recorded_at DESC);

-- Partial-unique dedupe matching the in-memory `${scope}:${teamId}:${agentId|tool|*}:${threshold}` key.
-- Three indexes, one per scope, so NULL columns do not break the uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_control_plane_budget_alerts_team_scope
  ON control_plane_budget_alerts (team_id, threshold)
  WHERE scope = 'team';
CREATE UNIQUE INDEX IF NOT EXISTS uq_control_plane_budget_alerts_agent_scope
  ON control_plane_budget_alerts (team_id, agent_id, threshold)
  WHERE scope = 'agent' AND agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_control_plane_budget_alerts_tool_scope
  ON control_plane_budget_alerts (team_id, tool_name, threshold)
  WHERE scope = 'tool' AND tool_name IS NOT NULL;

ALTER TABLE control_plane_budget_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_budget_alerts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_plane_budget_alerts_tenant_isolation ON control_plane_budget_alerts;
CREATE POLICY control_plane_budget_alerts_tenant_isolation
ON control_plane_budget_alerts
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

COMMIT;
