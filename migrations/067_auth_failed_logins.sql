-- Migration 067: failed-login telemetry for abuse-signal detection.
--
-- Populated by a Supabase auth webhook (see docs/admin-console/setup.md) that
-- fires on `auth.user.failed_login`. The admin console computes derived signals
-- from this table:
--   - password-spray: >3 failed logins in 5 min from the same IP across
--     different accounts
--   - new-geo: first login from a country never seen for that user
--   - new-device: first login from a UA hash never seen for that user
--
-- A small TTL — we retain 90 days to keep the table bounded.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_failed_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_email text NULL,
  user_id text NULL,
  ip inet NULL,
  user_agent text NULL,
  country text NULL,
  reason text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_failed_logins_user_at
  ON auth_failed_logins (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_failed_logins_ip_at
  ON auth_failed_logins (ip, occurred_at DESC)
  WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_failed_logins_email_at
  ON auth_failed_logins (lower(attempted_email), occurred_at DESC)
  WHERE attempted_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_failed_logins_at
  ON auth_failed_logins (occurred_at DESC);

ALTER TABLE auth_failed_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_failed_logins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_failed_logins_admin_only ON auth_failed_logins;
CREATE POLICY auth_failed_logins_admin_only
  ON auth_failed_logins
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- ------------------------------------------------------------------
-- auth_login_devices — every (user, device-fingerprint, country)
-- triple we've observed. First insert = new-geo / new-device signal.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_login_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  user_agent_hash text NOT NULL,
  country text NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  login_count integer NOT NULL DEFAULT 1,
  UNIQUE (user_id, user_agent_hash, country)
);

CREATE INDEX IF NOT EXISTS idx_auth_login_devices_user_last
  ON auth_login_devices (user_id, last_seen_at DESC);

ALTER TABLE auth_login_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_login_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_login_devices_admin_only ON auth_login_devices;
CREATE POLICY auth_login_devices_admin_only
  ON auth_login_devices
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
