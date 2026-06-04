-- HEL-559: RLS hardening for the memory tables + runs/routines tenant policies.
-- Verified against autoflow-dev (pjbpcfmidpxplcrwpcyk) before writing.
--
-- Safety context: the application connects as `postgres` — the table OWNER, which
-- also has rolbypassrls=true — so it BYPASSES RLS entirely. These policies are
-- therefore pure defense-in-depth for any *non-bypass* role (e.g. the Supabase
-- REST API). That's why every change below carries zero app-behaviour risk.
--
-- (A) FORCE RLS on the Layer-1/2/3 memory tables + wake_events. They were the
--     only customer tables ENABLE-without-FORCE; every comparable table
--     (companies, agents, runs, routines, workflows) is already rls_forced=true.
-- (C) Their policies checked `current_setting('autoflow.user_id')` — a GUC the
--     middleware NEVER sets (workspaceContext.ts sets `app.current_user_id` /
--     `app.current_workspace_id`). The policies were therefore DEAD (deny-all for
--     any non-bypass role). Re-point them at the canonical `app.current_user_id`
--     GUC so they actually scope by workspace membership.
-- (B) runs/routines RLS passed through `workspace_id IS NULL` rows to every caller
--     (copied from the workflows global-template policy). runs/routines are always
--     workspace-scoped — 0 NULL-workspace rows on dev, and no code path creates
--     NULL-workspace runs — so drop the passthrough. It stays ONLY on
--     workflows/workflow_versions, which legitimately hold global templates.
--
-- NOT NULL on runs/routines.workspace_id is intentionally NOT added: the policy
-- tightening already removes the cross-tenant exposure, and a column constraint
-- could fail the boot migration on any environment that happens to hold a legacy
-- NULL-workspace row. The RLS fix is sufficient and risk-free.

BEGIN;

-- (A) FORCE RLS on the memory tables -----------------------------------------
ALTER TABLE workspace_instructions FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items        FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_episodes         FORCE ROW LEVEL SECURITY;
ALTER TABLE wake_events            FORCE ROW LEVEL SECURITY;

-- (C) Re-point memory policies at the canonical `app.current_user_id` GUC -----
DROP POLICY IF EXISTS workspace_instructions_member_access ON workspace_instructions;
CREATE POLICY workspace_instructions_member_access ON workspace_instructions
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_read ON knowledge_items;
CREATE POLICY knowledge_items_member_read ON knowledge_items FOR SELECT
  USING (
    scope = 'autoflow_curated'
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_write ON knowledge_items;
CREATE POLICY knowledge_items_member_write ON knowledge_items FOR INSERT
  WITH CHECK (
    scope = 'workspace'
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_update ON knowledge_items;
CREATE POLICY knowledge_items_member_update ON knowledge_items FOR UPDATE
  USING (
    scope = 'workspace'
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS agent_episodes_member_access ON agent_episodes;
CREATE POLICY agent_episodes_member_access ON agent_episodes
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS wake_events_member_access ON wake_events;
CREATE POLICY wake_events_member_access ON wake_events
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id', true)
    )
  );

-- (B) Drop the NULL-workspace passthrough on runs + routines ------------------
DROP POLICY IF EXISTS runs_tenant_isolation ON runs;
CREATE POLICY runs_tenant_isolation ON runs
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );

DROP POLICY IF EXISTS routines_tenant_isolation ON routines;
CREATE POLICY routines_tenant_isolation ON routines
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );

COMMIT;
