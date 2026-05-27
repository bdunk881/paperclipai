-- Migration 058: platform-admin flag on user_profiles (admin-console foundations).
--
-- Adds a single boolean to mark the small set of AutoFlow staff who can access
-- the cross-tenant admin console (admin.helloautoflow.com). Companion to the
-- existing env-var allowlist (AUTOFLOW_STAFF_USER_IDS, src/admin/staffAuth.ts):
-- the env var still gates a few legacy admin endpoints; this flag is the new
-- canonical source of truth for the admin console.
--
-- The flag must be granted explicitly via psql one-off — there is no UI to
-- toggle it, because granting platform-admin to oneself is the canonical
-- privilege-escalation attack and a UI button is the wrong primitive.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Partial index — typically only a few rows are true.
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_platform_admin
  ON user_profiles (user_id)
  WHERE is_platform_admin = true;

COMMENT ON COLUMN user_profiles.is_platform_admin IS
  'Flags AutoFlow internal staff who can access the cross-tenant admin console. Granted manually via psql; never toggled from a UI.';

COMMIT;
