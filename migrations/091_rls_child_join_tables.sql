-- Migration 091: enable Row Level Security on 7 child / JOIN tables.
--
-- HEL-276 — Phase 5 of HEL-271's RLS rollout. All prerequisites are Done:
--   Phase 1 (HEL-272) — withUserContext helper + user-scoped repo refactor
--   Phase 2 (HEL-273) — RLS on user-scoped tables (migration 083)
--   Phase 3 (HEL-274) — RLS on catalog + system tables (migration 084)
--   Phase 4a (HEL-297) — workspace-scoped repo refactor
--   Phase 4  (HEL-275) — RLS on workspace-scoped tables (migration 087)
--
-- These 7 tables don't carry their own workspace_id / user_id — they inherit
-- scope through a parent table JOIN. Highest implementation risk in the series
-- because EXISTS subqueries can alter query plans. EXPLAIN verification should
-- be run on production before promoting this migration.
--
-- Three policy groups:
--
--   Ticket family (3 tables)  — ticket_id → tickets.workspace_id
--     PERMISSIVE FOR ALL: <t>_via_ticket
--     PERMISSIVE FOR SELECT: <t>_admin_read
--
--   Approval notifications (1 table) — approval_request_id → approval_requests.user_id
--     PERMISSIVE FOR ALL: approval_notifications_via_request
--     PERMISSIVE FOR SELECT: approval_notifications_admin_read
--     Note: approval_requests itself has deny-all RLS (migration 084). The
--     EXISTS JOIN still correctly denies anon/authenticated access while
--     the service role (BYPASSRLS) can still read approval_notifications
--     via the backend.
--
--   User-scoped (3 tables) — direct user_id column
--     PERMISSIVE FOR ALL: <t>_user_isolation
--     PERMISSIVE FOR SELECT: <t>_admin_read
--
-- Backend context: all callers use the BYPASSRLS postgres service role
-- (DATABASE_URL) so FORCE ROW LEVEL SECURITY does not affect backend ops.
-- These policies exclusively lock out anon/authenticated PostgREST access.

BEGIN;

-- ====================================================================
-- Ticket family — scope via tickets.workspace_id
-- ====================================================================

-- ------------------------------------------------------------------
-- 1. ticket_assignments  (ticket_id uuid → tickets.workspace_id uuid)
-- ------------------------------------------------------------------
ALTER TABLE public.ticket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_assignments_via_ticket ON public.ticket_assignments;
CREATE POLICY ticket_assignments_via_ticket ON public.ticket_assignments
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_assignments.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_assignments.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  );

DROP POLICY IF EXISTS ticket_assignments_admin_read ON public.ticket_assignments;
CREATE POLICY ticket_assignments_admin_read ON public.ticket_assignments
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 2. ticket_updates  (ticket_id uuid → tickets.workspace_id uuid)
-- ------------------------------------------------------------------
ALTER TABLE public.ticket_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_updates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_updates_via_ticket ON public.ticket_updates;
CREATE POLICY ticket_updates_via_ticket ON public.ticket_updates
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_updates.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_updates.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  );

DROP POLICY IF EXISTS ticket_updates_admin_read ON public.ticket_updates;
CREATE POLICY ticket_updates_admin_read ON public.ticket_updates
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 3. ticket_notifications  (ticket_id uuid → tickets.workspace_id uuid)
-- ------------------------------------------------------------------
ALTER TABLE public.ticket_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_notifications_via_ticket ON public.ticket_notifications;
CREATE POLICY ticket_notifications_via_ticket ON public.ticket_notifications
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_notifications.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_notifications.ticket_id
         AND t.workspace_id::text = app_current_workspace_id()::text
    )
  );

DROP POLICY IF EXISTS ticket_notifications_admin_read ON public.ticket_notifications;
CREATE POLICY ticket_notifications_admin_read ON public.ticket_notifications
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ====================================================================
-- Approval notifications — scope via approval_requests.user_id
-- ====================================================================

-- ------------------------------------------------------------------
-- 4. approval_notifications
--    (approval_request_id uuid → approval_requests.user_id text)
--
--    approval_requests has deny-all FORCE RLS (migration 084) for anon/
--    authenticated, so the EXISTS subquery evaluates to false for those
--    roles — correctly denying access to approval_notifications too.
--    The service role (BYPASSRLS) evaluates the subquery without RLS
--    restrictions and accesses the data normally.
-- ------------------------------------------------------------------
ALTER TABLE public.approval_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_notifications_via_request ON public.approval_notifications;
CREATE POLICY approval_notifications_via_request ON public.approval_notifications
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM approval_requests ar
       WHERE ar.id = approval_notifications.approval_request_id
         AND ar.user_id::text = app_current_user_id()
    )
  )
  WITH CHECK (
    app_current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM approval_requests ar
       WHERE ar.id = approval_notifications.approval_request_id
         AND ar.user_id::text = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS approval_notifications_admin_read ON public.approval_notifications;
CREATE POLICY approval_notifications_admin_read ON public.approval_notifications
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ====================================================================
-- User-scoped — direct user_id column
-- ====================================================================

-- ------------------------------------------------------------------
-- 5. company_lifecycle  (user_id text PRIMARY KEY, was
--    control_plane_company_lifecycle before migration 021)
-- ------------------------------------------------------------------
ALTER TABLE public.company_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_lifecycle FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_lifecycle_user_isolation ON public.company_lifecycle;
CREATE POLICY company_lifecycle_user_isolation ON public.company_lifecycle
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS company_lifecycle_admin_read ON public.company_lifecycle;
CREATE POLICY company_lifecycle_admin_read ON public.company_lifecycle
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 6. company_lifecycle_audit  (user_id text NOT NULL, was
--    control_plane_company_lifecycle_audit before migration 021)
-- ------------------------------------------------------------------
ALTER TABLE public.company_lifecycle_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_lifecycle_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_lifecycle_audit_user_isolation ON public.company_lifecycle_audit;
CREATE POLICY company_lifecycle_audit_user_isolation ON public.company_lifecycle_audit
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS company_lifecycle_audit_admin_read ON public.company_lifecycle_audit;
CREATE POLICY company_lifecycle_audit_admin_read ON public.company_lifecycle_audit
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 7. memory_entries  (user_id text NOT NULL; from migration 002,
--    distinct from agent_memory_entries which was covered in Phase 4)
-- ------------------------------------------------------------------
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_entries_user_isolation ON public.memory_entries;
CREATE POLICY memory_entries_user_isolation ON public.memory_entries
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS memory_entries_admin_read ON public.memory_entries;
CREATE POLICY memory_entries_admin_read ON public.memory_entries
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ============================================================================
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS ticket_assignments_via_ticket   ON public.ticket_assignments;
-- DROP POLICY IF EXISTS ticket_assignments_admin_read   ON public.ticket_assignments;
-- ALTER TABLE public.ticket_assignments DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS ticket_updates_via_ticket       ON public.ticket_updates;
-- DROP POLICY IF EXISTS ticket_updates_admin_read       ON public.ticket_updates;
-- ALTER TABLE public.ticket_updates DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS ticket_notifications_via_ticket ON public.ticket_notifications;
-- DROP POLICY IF EXISTS ticket_notifications_admin_read ON public.ticket_notifications;
-- ALTER TABLE public.ticket_notifications DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS approval_notifications_via_request ON public.approval_notifications;
-- DROP POLICY IF EXISTS approval_notifications_admin_read  ON public.approval_notifications;
-- ALTER TABLE public.approval_notifications DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS company_lifecycle_user_isolation ON public.company_lifecycle;
-- DROP POLICY IF EXISTS company_lifecycle_admin_read     ON public.company_lifecycle;
-- ALTER TABLE public.company_lifecycle DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS company_lifecycle_audit_user_isolation ON public.company_lifecycle_audit;
-- DROP POLICY IF EXISTS company_lifecycle_audit_admin_read     ON public.company_lifecycle_audit;
-- ALTER TABLE public.company_lifecycle_audit DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS memory_entries_user_isolation ON public.memory_entries;
-- DROP POLICY IF EXISTS memory_entries_admin_read     ON public.memory_entries;
-- ALTER TABLE public.memory_entries DISABLE ROW LEVEL SECURITY;
--
-- COMMIT;
