-- Migration 084: enable Row Level Security on catalog + system tables (Cat E/F).
--
-- HEL-274 — Phase 3 of HEL-271's RLS rollout. Locks down 7 tables that are
-- either read-only catalog data or backend-only system tables. The backend
-- writes via the BYPASSRLS `postgres` role (DATABASE_URL), so RESTRICTIVE
-- write/deny policies do not affect backend operations — they only lock out
-- anon/authenticated access via the publishable key.
--
-- Three policy patterns:
--
--   Catalog        (hosted_model_pricing, credit_packs):
--     SELECT TO public USING (true) + RESTRICTIVE no-INSERT/UPDATE/DELETE.
--     Anon/authenticated can read; only bypass roles can write.
--
--   Admin-only     (platform_provider_keys):
--     PERMISSIVE FOR ALL using app_is_platform_admin().
--     Mirrors the auth_failed_logins pattern from migration 067.
--
--   Deny-all       (__sql_migrations, stripe_webhook_events,
--                   social_auth_users, approval_requests):
--     RESTRICTIVE FOR ALL using false.
--     Backend continues to read/write via BYPASSRLS roles.

BEGIN;

-- ============================================================================
-- Catalog (read-only to anon/authenticated)
-- ============================================================================

-- 1. hosted_model_pricing (15 rows)
ALTER TABLE public.hosted_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_model_pricing FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hosted_model_pricing_authenticated_read ON public.hosted_model_pricing;
CREATE POLICY hosted_model_pricing_authenticated_read ON public.hosted_model_pricing
  AS PERMISSIVE FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS hosted_model_pricing_no_insert ON public.hosted_model_pricing;
CREATE POLICY hosted_model_pricing_no_insert ON public.hosted_model_pricing
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (false);

DROP POLICY IF EXISTS hosted_model_pricing_no_update ON public.hosted_model_pricing;
CREATE POLICY hosted_model_pricing_no_update ON public.hosted_model_pricing
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS hosted_model_pricing_no_delete ON public.hosted_model_pricing;
CREATE POLICY hosted_model_pricing_no_delete ON public.hosted_model_pricing
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- 2. credit_packs (5 rows)
ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_packs_authenticated_read ON public.credit_packs;
CREATE POLICY credit_packs_authenticated_read ON public.credit_packs
  AS PERMISSIVE FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS credit_packs_no_insert ON public.credit_packs;
CREATE POLICY credit_packs_no_insert ON public.credit_packs
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (false);

DROP POLICY IF EXISTS credit_packs_no_update ON public.credit_packs;
CREATE POLICY credit_packs_no_update ON public.credit_packs
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS credit_packs_no_delete ON public.credit_packs;
CREATE POLICY credit_packs_no_delete ON public.credit_packs
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ============================================================================
-- Admin-only (AutoFlow's hosted-LLM API keys; never customer-readable)
-- ============================================================================

-- 3. platform_provider_keys (0 rows)
ALTER TABLE public.platform_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_provider_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_provider_keys_admin_only ON public.platform_provider_keys;
CREATE POLICY platform_provider_keys_admin_only ON public.platform_provider_keys
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- ============================================================================
-- Deny-all system tables (backend continues via BYPASSRLS)
-- ============================================================================

-- 4. __sql_migrations (117 rows) — deploy-time schema state
ALTER TABLE public.__sql_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.__sql_migrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS __sql_migrations_deny_all ON public.__sql_migrations;
CREATE POLICY __sql_migrations_deny_all ON public.__sql_migrations
  AS RESTRICTIVE FOR ALL TO public
  USING (false) WITH CHECK (false);

-- 5. stripe_webhook_events (0 rows) — webhook ingestion log
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_webhook_events_deny_all ON public.stripe_webhook_events;
CREATE POLICY stripe_webhook_events_deny_all ON public.stripe_webhook_events
  AS RESTRICTIVE FOR ALL TO public
  USING (false) WITH CHECK (false);

-- 6. social_auth_users (0 rows) — legacy OAuth → user mapping
ALTER TABLE public.social_auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_auth_users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_auth_users_deny_all ON public.social_auth_users;
CREATE POLICY social_auth_users_deny_all ON public.social_auth_users
  AS RESTRICTIVE FOR ALL TO public
  USING (false) WITH CHECK (false);

-- 7. approval_requests (0 rows) — pre-canonical approval flow being phased out
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_requests_deny_all ON public.approval_requests;
CREATE POLICY approval_requests_deny_all ON public.approval_requests
  AS RESTRICTIVE FOR ALL TO public
  USING (false) WITH CHECK (false);

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ============================================================================
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS hosted_model_pricing_authenticated_read ON public.hosted_model_pricing;
-- DROP POLICY IF EXISTS hosted_model_pricing_no_insert          ON public.hosted_model_pricing;
-- DROP POLICY IF EXISTS hosted_model_pricing_no_update          ON public.hosted_model_pricing;
-- DROP POLICY IF EXISTS hosted_model_pricing_no_delete          ON public.hosted_model_pricing;
-- ALTER TABLE public.hosted_model_pricing DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS credit_packs_authenticated_read ON public.credit_packs;
-- DROP POLICY IF EXISTS credit_packs_no_insert          ON public.credit_packs;
-- DROP POLICY IF EXISTS credit_packs_no_update          ON public.credit_packs;
-- DROP POLICY IF EXISTS credit_packs_no_delete          ON public.credit_packs;
-- ALTER TABLE public.credit_packs DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS platform_provider_keys_admin_only ON public.platform_provider_keys;
-- ALTER TABLE public.platform_provider_keys DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS __sql_migrations_deny_all ON public.__sql_migrations;
-- ALTER TABLE public.__sql_migrations DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS stripe_webhook_events_deny_all ON public.stripe_webhook_events;
-- ALTER TABLE public.stripe_webhook_events DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS social_auth_users_deny_all ON public.social_auth_users;
-- ALTER TABLE public.social_auth_users DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS approval_requests_deny_all ON public.approval_requests;
-- ALTER TABLE public.approval_requests DISABLE ROW LEVEL SECURITY;
--
-- COMMIT;
