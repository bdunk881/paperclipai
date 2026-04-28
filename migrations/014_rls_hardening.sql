-- Migration 014: RLS Policy Hardening for Multi-Tenant Isolation (ALT-1915)
--
-- Addresses GAP-1: Adds explicit NULL denial to all existing RLS policies
-- so that queries with unset app.current_workspace_id are denied rather
-- than silently returning empty results (defense-in-depth).
--
-- Also adds RLS policies for tables introduced in migrations 008 and 010
-- that were missing tenant isolation entirely.

BEGIN;

-- ============================================================
-- Part 1: Harden existing RLS policies with NULL denial
-- ============================================================

-- 1a. workspaces — special case: also checks ownership/membership
DROP POLICY IF EXISTS workspaces_tenant_isolation ON workspaces;
CREATE POLICY workspaces_tenant_isolation
ON workspaces
USING (
  app_current_workspace_id() IS NOT NULL
  AND id = app_current_workspace_id()
  AND (
    owner_user_id = app_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = app_current_user_id()
    )
  )
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND id = app_current_workspace_id()
);

-- 1b. workspace_members
DROP POLICY IF EXISTS workspace_members_tenant_isolation ON workspace_members;
CREATE POLICY workspace_members_tenant_isolation
ON workspace_members
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 1c. icp_profiles
DROP POLICY IF EXISTS icp_profiles_tenant_isolation ON icp_profiles;
CREATE POLICY icp_profiles_tenant_isolation
ON icp_profiles
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 1d. leads
DROP POLICY IF EXISTS leads_tenant_isolation ON leads;
CREATE POLICY leads_tenant_isolation
ON leads
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 1e. campaigns
DROP POLICY IF EXISTS campaigns_tenant_isolation ON campaigns;
CREATE POLICY campaigns_tenant_isolation
ON campaigns
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 1f. email_sends
DROP POLICY IF EXISTS email_sends_tenant_isolation ON email_sends;
CREATE POLICY email_sends_tenant_isolation
ON email_sends
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- Part 2: Add RLS to tables missing tenant isolation
-- ============================================================

-- 2a. tickets (from migration 008)
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_tenant_isolation
ON tickets
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 2b. ticket_sla_policies (from migration 010)
ALTER TABLE ticket_sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_sla_policies_tenant_isolation
ON ticket_sla_policies
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- 2c. ticket_sla_snapshots (from migration 010)
ALTER TABLE ticket_sla_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_sla_snapshots_tenant_isolation
ON ticket_sla_snapshots
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

COMMIT;
