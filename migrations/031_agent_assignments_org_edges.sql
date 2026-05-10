-- Migration 031: agent_assignments + org_edges + agents.company_id (HEL-14)
--
-- The `agents` table already exists (renamed from control_plane_agents in
-- 021) with workspace_id, team_id, name, role_key, model, budget_monthly_usd,
-- reporting_to_agent_id, skills, status. HEL-14 adds:
--
-- 1. agents.company_id — link the agent to the canonical company that
--    owns it (HEL-13 missions). Optional for now; legacy agents predate
--    the canonical companies model.
--
-- 2. agent_assignments (agent_id, routine_id, assigned_at) — bridge table
--    saying which agent runs which routine (HEL-15 routines). UNIQUE on
--    the pair so an agent isn't double-assigned to the same routine.
--
-- 3. org_edges (manager_agent_id → agent_id) — explicit edges table.
--    The legacy reporting_to_agent_id self-FK on agents continues to work
--    for the simple parent-pointer query path; org_edges supports
--    future patterns (multi-manager, tracked transitions, role-typed
--    edges) without retrofitting agents. Cycle prevention is enforced
--    by a recursive-CTE BEFORE-INSERT trigger.

BEGIN;

-- ============================================================
-- agents.company_id
-- ============================================================
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_company_id
  ON agents (company_id) WHERE company_id IS NOT NULL;

-- ============================================================
-- agent_assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, routine_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_assignments_workspace_id
  ON agent_assignments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_routine_id
  ON agent_assignments (routine_id);

ALTER TABLE agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_assignments_tenant_isolation ON agent_assignments;
CREATE POLICY agent_assignments_tenant_isolation
ON agent_assignments
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- org_edges
-- ============================================================
CREATE TABLE IF NOT EXISTS org_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  manager_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_agent_id, agent_id),
  -- An agent can't manage itself.
  CONSTRAINT org_edges_no_self_loop CHECK (manager_agent_id <> agent_id)
);

CREATE INDEX IF NOT EXISTS idx_org_edges_workspace_id
  ON org_edges (workspace_id);
CREATE INDEX IF NOT EXISTS idx_org_edges_agent_id
  ON org_edges (agent_id);
CREATE INDEX IF NOT EXISTS idx_org_edges_manager_agent_id
  ON org_edges (manager_agent_id);

ALTER TABLE org_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_edges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_edges_tenant_isolation ON org_edges;
CREATE POLICY org_edges_tenant_isolation
ON org_edges
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Cycle prevention: BEFORE INSERT trigger walks up the proposed manager's
-- chain and rejects if `agent_id` is reachable as an ancestor (which would
-- close the cycle).
CREATE OR REPLACE FUNCTION org_edges_assert_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE chain(ancestor_id) AS (
      SELECT NEW.manager_agent_id
      UNION ALL
      SELECT oe.manager_agent_id
        FROM org_edges oe
        JOIN chain c ON oe.agent_id = c.ancestor_id
    )
    SELECT 1 FROM chain WHERE ancestor_id = NEW.agent_id
  ) THEN
    RAISE EXCEPTION 'org_edges cycle detected: agent % is already an ancestor of manager %',
      NEW.agent_id, NEW.manager_agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_edges_no_cycle ON org_edges;
CREATE TRIGGER org_edges_no_cycle
  BEFORE INSERT OR UPDATE ON org_edges
  FOR EACH ROW EXECUTE FUNCTION org_edges_assert_no_cycle();

COMMIT;
