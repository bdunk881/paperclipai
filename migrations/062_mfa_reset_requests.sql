-- Migration 062: MFA reset requests — OTP-confirmed factor wipes.
--
-- When an admin clicks "Reset MFA" we DON'T immediately wipe factors. Instead
-- we email the user a 6-digit OTP (TTL 15 min) with a "this was requested by
-- AutoFlow Support" disclaimer. The user confirms either by reading the code
-- to the support channel or by entering it in the dashboard. Only after a
-- single-use OTP verification do we call supabase.auth.admin.deleteFactor.
--
-- Storing only the hash (sha256) so a DB leak doesn't expose live OTPs.

BEGIN;

CREATE TABLE IF NOT EXISTS mfa_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  admin_user_id text NOT NULL,
  otp_hash text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  cancelled_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_requests_user_at
  ON mfa_reset_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_reset_requests_active
  ON mfa_reset_requests (user_id, expires_at)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE mfa_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_reset_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_reset_requests_admin_only ON mfa_reset_requests;
CREATE POLICY mfa_reset_requests_admin_only
  ON mfa_reset_requests
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
