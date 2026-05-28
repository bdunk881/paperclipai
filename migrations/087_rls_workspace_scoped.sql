-- Migration 087: enable Row Level Security on the workspace-scoped + HITL tables.
--
-- HEL-275 — Phase 4 of HEL-271's RLS rollout. Depends on the Phase 4a refactor
-- (HEL-297, PR #1133) that wraps every read/write against these tables in
-- withWorkspaceContext, which sets `app.current_workspace_id` (and
-- `app.current_user_id`) via SET LOCAL per transaction.
--
-- 15 tables total, split into two categories:
--
--   Cat B (10) — direct workspace_id (uuid). Policy matches workspace_id
--                against app_current_workspace_id().
--   Cat D (5)  — HITL family. company_id is text; companies.id is uuid;
--                policy joins via EXISTS (SELECT 1 FROM companies …) with
--                an explicit ::text cast on c.id. Plus a user_self_access
--                override so a user can read/write their own HITL artefacts
--                when only the user GUC is set (e.g. system contexts that
--                set app_current_user_id but not app_current_workspace_id).
--
-- Policy shape, per Phase 1 / Phase 2 / Phase 3 precedent:
--   - PERMISSIVE FOR ALL: <t>_workspace_isolation (or _workspace_via_company)
--   - PERMISSIVE FOR SELECT: <t>_admin_read — platform admins debug-read
--   - PERMISSIVE FOR ALL: <t>_user_self_access (Cat D only)
--
-- Order: Cat B with mostly-empty tables (credit/approval/notification) first,
-- agent_memory_* last so any wrapper regression there surfaces after the
-- safer policies have landed but before HITL.
--
-- Verification:
--   1. End-to-end agent run — confirms agent_memory_entries / kg_facts /
--      heartbeat / events writes succeed under RLS.
--   2. /api/notifications page loads — confirms notification_* reads.
--   3. HITL flow: trigger a checkpoint, assign to a human, confirm the
--      assignee can read the artefact via Cat D policy.
--   4. Cross-workspace probe via API: as workspace A user, request workspace
--      B data — expect 0 rows / 404.
--   5. Anon-key probe (via Supabase REST) on notification_events,
--      agent_memory_kg_facts — expect 0 rows.

BEGIN;

-- ====================================================================
-- Cat B — direct workspace_id (uuid)
-- ====================================================================

-- ------------------------------------------------------------------
-- 1. credit_purchase_events (uuid workspace_id, 0 rows in dev)
-- ------------------------------------------------------------------
ALTER TABLE public.credit_purchase_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_purchase_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_purchase_events_workspace_isolation ON public.credit_purchase_events;
CREATE POLICY credit_purchase_events_workspace_isolation ON public.credit_purchase_events
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS credit_purchase_events_admin_read ON public.credit_purchase_events;
CREATE POLICY credit_purchase_events_admin_read ON public.credit_purchase_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 2. approval_tier_policies (uuid workspace_id)
-- ------------------------------------------------------------------
ALTER TABLE public.approval_tier_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_tier_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_tier_policies_workspace_isolation ON public.approval_tier_policies;
CREATE POLICY approval_tier_policies_workspace_isolation ON public.approval_tier_policies
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS approval_tier_policies_admin_read ON public.approval_tier_policies;
CREATE POLICY approval_tier_policies_admin_read ON public.approval_tier_policies
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 3. notification_preferences (uuid workspace_id)
-- ------------------------------------------------------------------
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_workspace_isolation ON public.notification_preferences;
CREATE POLICY notification_preferences_workspace_isolation ON public.notification_preferences
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS notification_preferences_admin_read ON public.notification_preferences;
CREATE POLICY notification_preferences_admin_read ON public.notification_preferences
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 4. notification_channel_configs (uuid workspace_id)
-- ------------------------------------------------------------------
ALTER TABLE public.notification_channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_channel_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_channel_configs_workspace_isolation ON public.notification_channel_configs;
CREATE POLICY notification_channel_configs_workspace_isolation ON public.notification_channel_configs
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS notification_channel_configs_admin_read ON public.notification_channel_configs;
CREATE POLICY notification_channel_configs_admin_read ON public.notification_channel_configs
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 5. notification_events (uuid workspace_id, append-only)
-- ------------------------------------------------------------------
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_events_workspace_isolation ON public.notification_events;
CREATE POLICY notification_events_workspace_isolation ON public.notification_events
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS notification_events_admin_read ON public.notification_events;
CREATE POLICY notification_events_admin_read ON public.notification_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 6. notification_deliveries (uuid workspace_id, append-only)
-- ------------------------------------------------------------------
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_deliveries_workspace_isolation ON public.notification_deliveries;
CREATE POLICY notification_deliveries_workspace_isolation ON public.notification_deliveries
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS notification_deliveries_admin_read ON public.notification_deliveries;
CREATE POLICY notification_deliveries_admin_read ON public.notification_deliveries
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 7. agent_memory_events (uuid workspace_id, append-only, agent runtime hot path)
-- ------------------------------------------------------------------
ALTER TABLE public.agent_memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_events_workspace_isolation ON public.agent_memory_events;
CREATE POLICY agent_memory_events_workspace_isolation ON public.agent_memory_events
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS agent_memory_events_admin_read ON public.agent_memory_events;
CREATE POLICY agent_memory_events_admin_read ON public.agent_memory_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 8. agent_heartbeat_logs (uuid workspace_id, append-only, agent runtime hot path)
-- ------------------------------------------------------------------
ALTER TABLE public.agent_heartbeat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_heartbeat_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_heartbeat_logs_workspace_isolation ON public.agent_heartbeat_logs;
CREATE POLICY agent_heartbeat_logs_workspace_isolation ON public.agent_heartbeat_logs
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS agent_heartbeat_logs_admin_read ON public.agent_heartbeat_logs;
CREATE POLICY agent_heartbeat_logs_admin_read ON public.agent_heartbeat_logs
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 9. agent_memory_kg_facts (uuid workspace_id, agent runtime hot path)
-- ------------------------------------------------------------------
ALTER TABLE public.agent_memory_kg_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_kg_facts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_kg_facts_workspace_isolation ON public.agent_memory_kg_facts;
CREATE POLICY agent_memory_kg_facts_workspace_isolation ON public.agent_memory_kg_facts
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS agent_memory_kg_facts_admin_read ON public.agent_memory_kg_facts;
CREATE POLICY agent_memory_kg_facts_admin_read ON public.agent_memory_kg_facts
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 10. agent_memory_entries (uuid workspace_id, agent runtime hot path,
--     primary entry-point write target for every agent run)
-- ------------------------------------------------------------------
ALTER TABLE public.agent_memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_entries_workspace_isolation ON public.agent_memory_entries;
CREATE POLICY agent_memory_entries_workspace_isolation ON public.agent_memory_entries
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL
              AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS agent_memory_entries_admin_read ON public.agent_memory_entries;
CREATE POLICY agent_memory_entries_admin_read ON public.agent_memory_entries
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());


-- ====================================================================
-- Cat D — HITL family (company_id text → companies.id::text join)
--
-- company_id and user_id are text in the HITL tables (see migration 041);
-- companies.id is uuid. The EXISTS join explicitly casts c.id::text to
-- match. user_id::text comparison is a no-op cast that mirrors Phase 1
-- precedent for consistency.
-- ====================================================================

-- ------------------------------------------------------------------
-- 11. hitl_schedules (text user_id, text company_id, 1 row in dev)
-- ------------------------------------------------------------------
ALTER TABLE public.hitl_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitl_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hitl_schedules_workspace_via_company ON public.hitl_schedules;
CREATE POLICY hitl_schedules_workspace_via_company ON public.hitl_schedules
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_schedules.company_id
                   AND c.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_schedules.company_id
                   AND c.workspace_id = app_current_workspace_id())
  );

DROP POLICY IF EXISTS hitl_schedules_user_self_access ON public.hitl_schedules;
CREATE POLICY hitl_schedules_user_self_access ON public.hitl_schedules
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

DROP POLICY IF EXISTS hitl_schedules_admin_read ON public.hitl_schedules;
CREATE POLICY hitl_schedules_admin_read ON public.hitl_schedules
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 12. hitl_checkpoints (text user_id, text company_id)
-- ------------------------------------------------------------------
ALTER TABLE public.hitl_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitl_checkpoints FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hitl_checkpoints_workspace_via_company ON public.hitl_checkpoints;
CREATE POLICY hitl_checkpoints_workspace_via_company ON public.hitl_checkpoints
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_checkpoints.company_id
                   AND c.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_checkpoints.company_id
                   AND c.workspace_id = app_current_workspace_id())
  );

DROP POLICY IF EXISTS hitl_checkpoints_user_self_access ON public.hitl_checkpoints;
CREATE POLICY hitl_checkpoints_user_self_access ON public.hitl_checkpoints
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

DROP POLICY IF EXISTS hitl_checkpoints_admin_read ON public.hitl_checkpoints;
CREATE POLICY hitl_checkpoints_admin_read ON public.hitl_checkpoints
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 13. hitl_artifact_comments (text user_id, text company_id)
-- ------------------------------------------------------------------
ALTER TABLE public.hitl_artifact_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitl_artifact_comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hitl_artifact_comments_workspace_via_company ON public.hitl_artifact_comments;
CREATE POLICY hitl_artifact_comments_workspace_via_company ON public.hitl_artifact_comments
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_artifact_comments.company_id
                   AND c.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_artifact_comments.company_id
                   AND c.workspace_id = app_current_workspace_id())
  );

DROP POLICY IF EXISTS hitl_artifact_comments_user_self_access ON public.hitl_artifact_comments;
CREATE POLICY hitl_artifact_comments_user_self_access ON public.hitl_artifact_comments
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

DROP POLICY IF EXISTS hitl_artifact_comments_admin_read ON public.hitl_artifact_comments;
CREATE POLICY hitl_artifact_comments_admin_read ON public.hitl_artifact_comments
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 14. hitl_ask_ceo_requests (text user_id, text company_id)
-- ------------------------------------------------------------------
ALTER TABLE public.hitl_ask_ceo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitl_ask_ceo_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hitl_ask_ceo_requests_workspace_via_company ON public.hitl_ask_ceo_requests;
CREATE POLICY hitl_ask_ceo_requests_workspace_via_company ON public.hitl_ask_ceo_requests
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_ask_ceo_requests.company_id
                   AND c.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_ask_ceo_requests.company_id
                   AND c.workspace_id = app_current_workspace_id())
  );

DROP POLICY IF EXISTS hitl_ask_ceo_requests_user_self_access ON public.hitl_ask_ceo_requests;
CREATE POLICY hitl_ask_ceo_requests_user_self_access ON public.hitl_ask_ceo_requests
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

DROP POLICY IF EXISTS hitl_ask_ceo_requests_admin_read ON public.hitl_ask_ceo_requests;
CREATE POLICY hitl_ask_ceo_requests_admin_read ON public.hitl_ask_ceo_requests
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 15. hitl_notifications (text user_id, text company_id)
-- ------------------------------------------------------------------
ALTER TABLE public.hitl_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitl_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hitl_notifications_workspace_via_company ON public.hitl_notifications;
CREATE POLICY hitl_notifications_workspace_via_company ON public.hitl_notifications
  AS PERMISSIVE FOR ALL TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_notifications.company_id
                   AND c.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (
    app_current_workspace_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM companies c
                 WHERE c.id::text = hitl_notifications.company_id
                   AND c.workspace_id = app_current_workspace_id())
  );

DROP POLICY IF EXISTS hitl_notifications_user_self_access ON public.hitl_notifications;
CREATE POLICY hitl_notifications_user_self_access ON public.hitl_notifications
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

DROP POLICY IF EXISTS hitl_notifications_admin_read ON public.hitl_notifications;
CREATE POLICY hitl_notifications_admin_read ON public.hitl_notifications
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

COMMIT;
