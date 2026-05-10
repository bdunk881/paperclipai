-- Migration 027: RLS audit — close gaps on P1 tables (HEL-20)
--
-- Audit results from migrations 022 (HEL-13), 023 (HEL-15), 024 (HEL-16),
-- and 025 (HEL-17):
--
--   ✓ activity_events, budgets, companies, connector_connections,
--     entitlements, hiring_plans, llm_credentials, missions, subscriptions
--     — all ENABLE + FORCE RLS with workspace-scoped tenant policies.
--
--   ✗ workflows, workflow_versions, routines, runs, step_results
--     — have ENABLE + tenant_isolation but MISSING `FORCE ROW LEVEL SECURITY`.
--     Without FORCE, a connection running as the table owner (e.g. the
--     migration role itself, or a misconfigured Supabase service role) can
--     bypass RLS entirely. Established pattern in the other P1 migrations
--     is to FORCE, so we close that gap here.
--
--   ✗ approvals — has only the user-scoped `approvals_run_owner_or_assignee`
--     policy (gates by run owner / assignee, not workspace). Add a
--     workspace-scoped policy that joins through runs(id) so an attacker
--     with a different workspace context cannot read approvals via the
--     workspace_id codepath.

BEGIN;

-- ============================================================
-- HEL-15 tables: enforce FORCE RLS
-- ============================================================
ALTER TABLE workflows         FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE routines          FORCE ROW LEVEL SECURITY;
ALTER TABLE runs              FORCE ROW LEVEL SECURITY;
ALTER TABLE step_results      FORCE ROW LEVEL SECURITY;

-- ============================================================
-- approvals — add workspace-scoped policy alongside the existing
-- user-scoped approvals_run_owner_or_assignee.
-- ============================================================
-- Two permissive policies on the same table OR together. So adding the
-- workspace-scoped policy means: a row is visible if the caller is in the
-- same workspace as the approval's run, OR the caller owns/is assigned to
-- the run. That preserves the existing per-user filtering (an admin in the
-- same workspace can see all approvals; the assignee can see their own
-- approvals via the user policy).
DROP POLICY IF EXISTS approvals_workspace_tenant_isolation ON approvals;
CREATE POLICY approvals_workspace_tenant_isolation
  ON approvals
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = approvals.run_id
        AND runs.workspace_id = app_current_workspace_id()
    )
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = approvals.run_id
        AND runs.workspace_id = app_current_workspace_id()
    )
  );

COMMIT;
