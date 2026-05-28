-- Migration 083: enable Row Level Security on the 10 user-scoped (Cat A) tables.
--
-- HEL-273 — Phase 2 of HEL-271's RLS rollout. Depends on the Phase 1 refactor
-- (HEL-272) that wraps every backend write/read into withUserContext(), which
-- sets `app.current_user_id` via SET LOCAL per transaction. With that in place,
-- enabling RLS here locks out anon-key reads against the Supabase REST surface
-- (the primary motivator: connector_credentials has 3 rows of real customer
-- credential blobs).
--
-- Policy shape per table:
--   - PERMISSIVE FOR ALL: <t>_user_isolation — matches user_id to GUC
--   - PERMISSIVE FOR SELECT: <t>_admin_read — platform admins can read
--   - RESTRICTIVE extras for append-only tables and mfa_recovery_codes (see below)
--
-- Order: MFA tables (0 rows) first so a bug surfaces before we touch
-- connector_credentials at the end.
--
-- Verify post-apply via anon-key probe:
--   curl "https://<proj>.supabase.co/rest/v1/connector_credentials?select=*" \
--     -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
--   # Expected: []   (was: 3 rows)

BEGIN;

-- ------------------------------------------------------------------
-- 1. mfa_webauthn_credentials  (uuid user_id, 0 rows)
-- ------------------------------------------------------------------
ALTER TABLE public.mfa_webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_webauthn_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_webauthn_credentials_user_isolation ON public.mfa_webauthn_credentials;
CREATE POLICY mfa_webauthn_credentials_user_isolation ON public.mfa_webauthn_credentials
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS mfa_webauthn_credentials_admin_read ON public.mfa_webauthn_credentials;
CREATE POLICY mfa_webauthn_credentials_admin_read ON public.mfa_webauthn_credentials
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 2. mfa_recovery_codes  (uuid user_id, 0 rows)
--    DELETE is forbidden — consumed codes get UPDATE used_at = now()
--    so they remain auditable. UPDATE is allowed by user_isolation.
-- ------------------------------------------------------------------
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_recovery_codes_user_isolation ON public.mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_user_isolation ON public.mfa_recovery_codes
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS mfa_recovery_codes_admin_read ON public.mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_admin_read ON public.mfa_recovery_codes
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

DROP POLICY IF EXISTS mfa_recovery_codes_no_delete ON public.mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_no_delete ON public.mfa_recovery_codes
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ------------------------------------------------------------------
-- 3. user_mfa_policy  (uuid user_id, 0 rows)
-- ------------------------------------------------------------------
ALTER TABLE public.user_mfa_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mfa_policy FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_mfa_policy_user_isolation ON public.user_mfa_policy;
CREATE POLICY user_mfa_policy_user_isolation ON public.user_mfa_policy
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS user_mfa_policy_admin_read ON public.user_mfa_policy;
CREATE POLICY user_mfa_policy_admin_read ON public.user_mfa_policy
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 4. observability_events  (text user_id, 0 rows, append-only)
-- ------------------------------------------------------------------
ALTER TABLE public.observability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observability_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS observability_events_user_isolation ON public.observability_events;
CREATE POLICY observability_events_user_isolation ON public.observability_events
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS observability_events_admin_read ON public.observability_events;
CREATE POLICY observability_events_admin_read ON public.observability_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

DROP POLICY IF EXISTS observability_events_no_update ON public.observability_events;
CREATE POLICY observability_events_no_update ON public.observability_events
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS observability_events_no_delete ON public.observability_events;
CREATE POLICY observability_events_no_delete ON public.observability_events
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ------------------------------------------------------------------
-- 5. webhook_relayed_events  (text user_id, 0 rows, append-only)
-- ------------------------------------------------------------------
ALTER TABLE public.webhook_relayed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_relayed_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_relayed_events_user_isolation ON public.webhook_relayed_events;
CREATE POLICY webhook_relayed_events_user_isolation ON public.webhook_relayed_events
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS webhook_relayed_events_admin_read ON public.webhook_relayed_events;
CREATE POLICY webhook_relayed_events_admin_read ON public.webhook_relayed_events
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

DROP POLICY IF EXISTS webhook_relayed_events_no_update ON public.webhook_relayed_events;
CREATE POLICY webhook_relayed_events_no_update ON public.webhook_relayed_events
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS webhook_relayed_events_no_delete ON public.webhook_relayed_events;
CREATE POLICY webhook_relayed_events_no_delete ON public.webhook_relayed_events
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ------------------------------------------------------------------
-- 6. mcp_servers  (text user_id, 0 rows)
-- ------------------------------------------------------------------
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_servers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_servers_user_isolation ON public.mcp_servers;
CREATE POLICY mcp_servers_user_isolation ON public.mcp_servers
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS mcp_servers_admin_read ON public.mcp_servers;
CREATE POLICY mcp_servers_admin_read ON public.mcp_servers
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 7. webhook_subscriptions  (text user_id, 0 rows)
-- ------------------------------------------------------------------
ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_subscriptions_user_isolation ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_user_isolation ON public.webhook_subscriptions
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS webhook_subscriptions_admin_read ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_admin_read ON public.webhook_subscriptions
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 8. generated_reports  (text user_id, 0 rows)
-- ------------------------------------------------------------------
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_reports_user_isolation ON public.generated_reports;
CREATE POLICY generated_reports_user_isolation ON public.generated_reports
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS generated_reports_admin_read ON public.generated_reports;
CREATE POLICY generated_reports_admin_read ON public.generated_reports
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 9. user_profiles  (text user_id, 1 row)
-- ------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_user_isolation ON public.user_profiles;
CREATE POLICY user_profiles_user_isolation ON public.user_profiles
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS user_profiles_admin_read ON public.user_profiles;
CREATE POLICY user_profiles_admin_read ON public.user_profiles
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ------------------------------------------------------------------
-- 10. connector_credentials  (text user_id, 3 live rows — applied last)
-- ------------------------------------------------------------------
ALTER TABLE public.connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_credentials_user_isolation ON public.connector_credentials;
CREATE POLICY connector_credentials_user_isolation ON public.connector_credentials
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS connector_credentials_admin_read ON public.connector_credentials;
CREATE POLICY connector_credentials_admin_read ON public.connector_credentials
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ============================================================================
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS mfa_webauthn_credentials_user_isolation ON public.mfa_webauthn_credentials;
-- DROP POLICY IF EXISTS mfa_webauthn_credentials_admin_read     ON public.mfa_webauthn_credentials;
-- ALTER TABLE public.mfa_webauthn_credentials DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS mfa_recovery_codes_user_isolation ON public.mfa_recovery_codes;
-- DROP POLICY IF EXISTS mfa_recovery_codes_admin_read     ON public.mfa_recovery_codes;
-- DROP POLICY IF EXISTS mfa_recovery_codes_no_delete      ON public.mfa_recovery_codes;
-- ALTER TABLE public.mfa_recovery_codes DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS user_mfa_policy_user_isolation ON public.user_mfa_policy;
-- DROP POLICY IF EXISTS user_mfa_policy_admin_read     ON public.user_mfa_policy;
-- ALTER TABLE public.user_mfa_policy DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS observability_events_user_isolation ON public.observability_events;
-- DROP POLICY IF EXISTS observability_events_admin_read     ON public.observability_events;
-- DROP POLICY IF EXISTS observability_events_no_update      ON public.observability_events;
-- DROP POLICY IF EXISTS observability_events_no_delete      ON public.observability_events;
-- ALTER TABLE public.observability_events DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS webhook_relayed_events_user_isolation ON public.webhook_relayed_events;
-- DROP POLICY IF EXISTS webhook_relayed_events_admin_read     ON public.webhook_relayed_events;
-- DROP POLICY IF EXISTS webhook_relayed_events_no_update      ON public.webhook_relayed_events;
-- DROP POLICY IF EXISTS webhook_relayed_events_no_delete      ON public.webhook_relayed_events;
-- ALTER TABLE public.webhook_relayed_events DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS mcp_servers_user_isolation ON public.mcp_servers;
-- DROP POLICY IF EXISTS mcp_servers_admin_read     ON public.mcp_servers;
-- ALTER TABLE public.mcp_servers DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS webhook_subscriptions_user_isolation ON public.webhook_subscriptions;
-- DROP POLICY IF EXISTS webhook_subscriptions_admin_read     ON public.webhook_subscriptions;
-- ALTER TABLE public.webhook_subscriptions DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS generated_reports_user_isolation ON public.generated_reports;
-- DROP POLICY IF EXISTS generated_reports_admin_read     ON public.generated_reports;
-- ALTER TABLE public.generated_reports DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS user_profiles_user_isolation ON public.user_profiles;
-- DROP POLICY IF EXISTS user_profiles_admin_read     ON public.user_profiles;
-- ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS connector_credentials_user_isolation ON public.connector_credentials;
-- DROP POLICY IF EXISTS connector_credentials_admin_read     ON public.connector_credentials;
-- ALTER TABLE public.connector_credentials DISABLE ROW LEVEL SECURITY;
--
-- COMMIT;
