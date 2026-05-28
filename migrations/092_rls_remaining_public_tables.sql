-- Migration 092: enable Row Level Security on 10 remaining public.* tables.
--
-- HEL-306 — clears the last 10 `rls_disabled_in_public` warnings surfaced by
-- the Supabase security advisor after HEL-273/274/275/276/304 covered earlier
-- phases. Three policy groups:
--
--   Admin-only (5 tables):   admin_agent_asks, admin_agent_replies,
--                             admin_agent_webhooks, admin_cost_thresholds,
--                             admin_infra_job_runs.
--     PERMISSIVE FOR ALL using app_is_platform_admin(). Mirrors the
--     workspace_feature_overrides pattern (migration 068). Writes come from
--     platform-admin console and scheduled jobs; never from customer sessions.
--
--   Knowledge / user-scoped (4 tables): knowledge_bases, knowledge_documents,
--                                        knowledge_chunks, knowledge_embeddings.
--     NOTE: issue description referenced workspace_id but the actual schema
--     (created by ensureKnowledgeSchema in knowledgeStore.ts) uses user_id text
--     on every table — there is no workspace_id column. User-scoped isolation
--     matches how knowledgeStore.ts already filters (WHERE user_id = $1).
--     PERMISSIVE FOR ALL: user_isolation + PERMISSIVE FOR SELECT: admin_read.
--
--   Reference / lock-down (1 table): subscription_tiers.
--     Backend (DATABASE_URL / BYPASSRLS) is the only reader; HEL-302 confirmed
--     the landing page does NOT hit PostgREST directly. Admin-only policy
--     (same shape as platform_provider_keys in migration 084).
--
-- All callers use the postgres BYPASSRLS role via DATABASE_URL so FORCE ROW
-- LEVEL SECURITY does not affect backend operations.

BEGIN;

-- ============================================================================
-- Admin-only tables (5)
-- ============================================================================

-- 1. admin_agent_webhooks
ALTER TABLE public.admin_agent_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_webhooks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_agent_webhooks_admin_only ON public.admin_agent_webhooks;
CREATE POLICY admin_agent_webhooks_admin_only ON public.admin_agent_webhooks
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- 2. admin_agent_asks
ALTER TABLE public.admin_agent_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_asks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_agent_asks_admin_only ON public.admin_agent_asks;
CREATE POLICY admin_agent_asks_admin_only ON public.admin_agent_asks
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- 3. admin_agent_replies
ALTER TABLE public.admin_agent_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_agent_replies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_agent_replies_admin_only ON public.admin_agent_replies;
CREATE POLICY admin_agent_replies_admin_only ON public.admin_agent_replies
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- 4. admin_cost_thresholds
ALTER TABLE public.admin_cost_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_cost_thresholds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_cost_thresholds_admin_only ON public.admin_cost_thresholds;
CREATE POLICY admin_cost_thresholds_admin_only ON public.admin_cost_thresholds
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- 5. admin_infra_job_runs
ALTER TABLE public.admin_infra_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_infra_job_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_infra_job_runs_admin_only ON public.admin_infra_job_runs;
CREATE POLICY admin_infra_job_runs_admin_only ON public.admin_infra_job_runs
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- ============================================================================
-- Knowledge / user-scoped tables (4)
-- ============================================================================

-- 6. knowledge_bases  (user_id text NOT NULL)
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_bases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_bases_user_isolation ON public.knowledge_bases;
CREATE POLICY knowledge_bases_user_isolation ON public.knowledge_bases
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS knowledge_bases_admin_read ON public.knowledge_bases;
CREATE POLICY knowledge_bases_admin_read ON public.knowledge_bases
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- 7. knowledge_documents  (user_id text NOT NULL)
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_documents_user_isolation ON public.knowledge_documents;
CREATE POLICY knowledge_documents_user_isolation ON public.knowledge_documents
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS knowledge_documents_admin_read ON public.knowledge_documents;
CREATE POLICY knowledge_documents_admin_read ON public.knowledge_documents
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- 8. knowledge_chunks  (user_id text NOT NULL)
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_chunks_user_isolation ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_user_isolation ON public.knowledge_chunks
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS knowledge_chunks_admin_read ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_admin_read ON public.knowledge_chunks
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- 9. knowledge_embeddings  (user_id text NOT NULL)
ALTER TABLE public.knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_embeddings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_embeddings_user_isolation ON public.knowledge_embeddings;
CREATE POLICY knowledge_embeddings_user_isolation ON public.knowledge_embeddings
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id = app_current_user_id());

DROP POLICY IF EXISTS knowledge_embeddings_admin_read ON public.knowledge_embeddings;
CREATE POLICY knowledge_embeddings_admin_read ON public.knowledge_embeddings
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ============================================================================
-- Reference / lock-down (1)
-- ============================================================================

-- 10. subscription_tiers  (catalog; backend reads via BYPASSRLS postgres role)
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_tiers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_tiers_admin_only ON public.subscription_tiers;
CREATE POLICY subscription_tiers_admin_only ON public.subscription_tiers
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ============================================================================
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS admin_agent_webhooks_admin_only  ON public.admin_agent_webhooks;
-- ALTER TABLE public.admin_agent_webhooks  DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS admin_agent_asks_admin_only      ON public.admin_agent_asks;
-- ALTER TABLE public.admin_agent_asks      DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS admin_agent_replies_admin_only   ON public.admin_agent_replies;
-- ALTER TABLE public.admin_agent_replies   DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS admin_cost_thresholds_admin_only ON public.admin_cost_thresholds;
-- ALTER TABLE public.admin_cost_thresholds DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS admin_infra_job_runs_admin_only  ON public.admin_infra_job_runs;
-- ALTER TABLE public.admin_infra_job_runs  DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS knowledge_bases_user_isolation      ON public.knowledge_bases;
-- DROP POLICY IF EXISTS knowledge_bases_admin_read          ON public.knowledge_bases;
-- ALTER TABLE public.knowledge_bases       DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS knowledge_documents_user_isolation  ON public.knowledge_documents;
-- DROP POLICY IF EXISTS knowledge_documents_admin_read      ON public.knowledge_documents;
-- ALTER TABLE public.knowledge_documents   DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS knowledge_chunks_user_isolation     ON public.knowledge_chunks;
-- DROP POLICY IF EXISTS knowledge_chunks_admin_read         ON public.knowledge_chunks;
-- ALTER TABLE public.knowledge_chunks      DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS knowledge_embeddings_user_isolation ON public.knowledge_embeddings;
-- DROP POLICY IF EXISTS knowledge_embeddings_admin_read     ON public.knowledge_embeddings;
-- ALTER TABLE public.knowledge_embeddings  DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS subscription_tiers_admin_only       ON public.subscription_tiers;
-- ALTER TABLE public.subscription_tiers    DISABLE ROW LEVEL SECURITY;
--
-- COMMIT;
