-- Migration 093 (HEL-282): email-OTP + magic-link as second-factor options.
--
-- Two new app-owned MFA channels for users who can't/won't use passkey or
-- TOTP. Both reuse the verified email already on file and — like the passkey
-- and recovery-code paths — mint the short-lived `autoflow_aal2_attestation`
-- cookie on a successful verify, so `requireAAL2` stays simple.
--
-- App-owned (NOT Supabase signInWithOtp / magic-link) because those flows are
-- sign-in flows; reusing them to step up an already-signed-in session risks
-- session-replacement bugs. See the HEL-282 ticket for the full rationale.
--
-- Tables:
--   mfa_email_otp   — one row per issued 6-digit code (salted SHA-256 hash)
--   mfa_magic_link  — one row per issued one-click token (SHA-256 hash)
-- plus two new flags on user_mfa_policy.
--
-- RLS posture mirrors migration 083 (HEL-273) — user-isolation keyed on
-- app_current_user_id() plus an admin SELECT policy — with ONE deliberate
-- difference: these tables ENABLE row security but do NOT FORCE it, whereas
-- 083 FORCEs the sibling MFA tables.
--
-- Why not FORCE: the magic-link token is consumed PRE-AUTH (clicked from an
-- email, no session, no app_current_user_id() GUC) via the SECURITY DEFINER
-- function consume_mfa_magic_link(). A SECURITY DEFINER function only bypasses
-- RLS if its owner is exempt — and the HEL-298 work proved the app/migration
-- role is itself SUBJECT to FORCE RLS (it needs withUserContext to see its own
-- rows), i.e. it lacks BYPASSRLS. So under FORCE the consume function would
-- silently return zero rows and magic links would never verify. ENABLE (not
-- FORCE) lets the table owner — which owns the function — bypass for that one
-- pre-auth path, while the non-owner PostgREST roles (anon / authenticated)
-- that 083 was actually closing off remain fully policy-gated. The authed
-- app path stays user-scoped via withUserContext + explicit WHERE user_id.
-- Possession of the 256-bit token is the capability; the function only
-- consumes one row by hash and returns the bound user_id.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Email OTP codes (salted SHA-256 at rest, 6-digit, 5-min TTL, 3 attempts)
-- ---------------------------------------------------------------------------
-- NOTE on auth.users FK: the sibling MFA tables (migration 075) store
-- `user_id UUID` with NO foreign key, and migration 063 attaches its
-- auth.users FK only inside a guarded DO block because bare-Postgres dev/CI
-- environments have no `auth` schema and would crashloop on an inline FK. We
-- follow 063's pattern: bare column here, conditional ON DELETE CASCADE FK
-- below (real Supabase gets the cascade; auth-less envs skip it).
CREATE TABLE IF NOT EXISTS mfa_email_otp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('enroll', 'verify')),
  attempts    SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_email_otp_user_active_idx
  ON mfa_email_otp (user_id) WHERE consumed_at IS NULL;

-- Rate-limit + cleanup queries scan recent rows per user regardless of
-- consumed state.
CREATE INDEX IF NOT EXISTS mfa_email_otp_user_created_idx
  ON mfa_email_otp (user_id, created_at DESC);

COMMENT ON TABLE mfa_email_otp IS
  'App-issued one-time 6-digit email codes for the email-OTP second factor (HEL-282). code_hash is a salted SHA-256 (s1$ scheme, same as mfa_recovery_codes). Codes expire after 5 minutes and lock after 3 failed attempts. Consumed rows are kept (consumed_at set) for audit/rate-limit.';

-- ---------------------------------------------------------------------------
-- 2. Magic-link tokens (SHA-256 of 32-byte random token, 5-min TTL, one-time)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_magic_link (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('enroll', 'verify')),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_magic_link_user_created_idx
  ON mfa_magic_link (user_id, created_at DESC);

-- Conditional auth.users FKs (see note above; mirrors migration 063).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'auth' AND c.relname = 'users' AND c.relkind = 'r'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfa_email_otp_user_id_fkey') THEN
      ALTER TABLE mfa_email_otp
        ADD CONSTRAINT mfa_email_otp_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfa_magic_link_user_id_fkey') THEN
      ALTER TABLE mfa_magic_link
        ADD CONSTRAINT mfa_magic_link_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE mfa_magic_link IS
  'App-issued one-click verification tokens for the magic-link second factor (HEL-282). token_hash is an unsalted SHA-256 of a 32-byte (256-bit) random token — no salt needed at that entropy. Tokens expire after 5 minutes and are one-time-use (consumed_at set). Consumption from the email click happens pre-auth via consume_mfa_magic_link().';

-- ---------------------------------------------------------------------------
-- 3. New per-user policy flags + widened last_verified_method CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE user_mfa_policy
  ADD COLUMN IF NOT EXISTS has_email_otp  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_magic_link BOOLEAN NOT NULL DEFAULT FALSE;

-- The original CHECK (migration 075) only allowed webauthn/totp/recovery_code.
-- Drop + recreate to add the two new app-owned methods.
ALTER TABLE user_mfa_policy
  DROP CONSTRAINT IF EXISTS user_mfa_policy_last_verified_method_check;
ALTER TABLE user_mfa_policy
  ADD CONSTRAINT user_mfa_policy_last_verified_method_check
  CHECK (last_verified_method IS NULL
         OR last_verified_method IN ('webauthn', 'totp', 'recovery_code',
                                     'email_otp', 'magic_link'));

-- ---------------------------------------------------------------------------
-- 4. RLS — policies as in migration 083, but ENABLE (not FORCE); see header.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mfa_email_otp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_email_otp_user_isolation ON public.mfa_email_otp;
CREATE POLICY mfa_email_otp_user_isolation ON public.mfa_email_otp
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS mfa_email_otp_admin_read ON public.mfa_email_otp;
CREATE POLICY mfa_email_otp_admin_read ON public.mfa_email_otp
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

ALTER TABLE public.mfa_magic_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_magic_link_user_isolation ON public.mfa_magic_link;
CREATE POLICY mfa_magic_link_user_isolation ON public.mfa_magic_link
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_user_id() IS NOT NULL
         AND user_id::text = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL
              AND user_id::text = app_current_user_id());

DROP POLICY IF EXISTS mfa_magic_link_admin_read ON public.mfa_magic_link;
CREATE POLICY mfa_magic_link_admin_read ON public.mfa_magic_link
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER consume function for the pre-auth magic-link click
-- ---------------------------------------------------------------------------
-- Clicked from an email as a top-level GET, so there is no bearer token and
-- no app_current_user_id() GUC — the user_isolation policy above would return
-- zero rows. This runs as the function owner (the table owner), which bypasses
-- RLS because the table is ENABLE-not-FORCE (see header). It atomically
-- consumes the matching unconsumed/unexpired row and returns the bound
-- user_id + purpose. Invalid/expired/already-consumed → no row.
CREATE OR REPLACE FUNCTION consume_mfa_magic_link(p_token_hash TEXT)
RETURNS TABLE (user_id UUID, purpose TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE mfa_magic_link
     SET consumed_at = now()
   WHERE token_hash = p_token_hash
     AND consumed_at IS NULL
     AND expires_at > now()
  RETURNING mfa_magic_link.user_id, mfa_magic_link.purpose;
$$;

COMMENT ON FUNCTION consume_mfa_magic_link(TEXT) IS
  'HEL-282: pre-auth consume of a magic-link token (email click, no user context). SECURITY DEFINER so the table owner executes and bypasses RLS (table is ENABLE-not-FORCE). Safe to expose: requires the 256-bit token, only consumes one row by hash and returns the bound user_id.';

-- Lock down EXECUTE per the migration-092 convention: revoke from PUBLIC,
-- re-grant only to the roles that run app/migrations. anon/authenticated
-- inherit from PUBLIC, so REVOKE FROM PUBLIC removes their access too. The
-- API pool connects as one of postgres / service_role / autoflow_api
-- depending on env; grant to all that exist.
REVOKE EXECUTE ON FUNCTION consume_mfa_magic_link(TEXT) FROM PUBLIC;
DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role', 'authenticated', 'autoflow_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.consume_mfa_magic_link(TEXT) TO %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
