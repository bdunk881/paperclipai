-- Migration 061: impersonation sessions ledger.
--
-- Read-only impersonation: a platform admin views the customer dashboard as a
-- specific user with a banner-marked, time-boxed token. Each session lives in
-- this table; the sweep job in src/adminConsole/impersonationSweep.ts marks
-- expired rows ended and the audit log captures every navigation made during
-- the session.

BEGIN;

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text NOT NULL,
  impersonated_user_id text NOT NULL,

  -- Locked to 'read_only' for v1. Future modes (e.g. 'write_with_approval')
  -- would extend the CHECK list.
  mode text NOT NULL DEFAULT 'read_only'
    CHECK (mode IN ('read_only')),

  reason text NOT NULL DEFAULT '',

  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  ended_reason text NULL
    CHECK (ended_reason IS NULL OR ended_reason IN ('expired', 'admin_ended', 'invalidated'))
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_admin_started
  ON impersonation_sessions (admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_target_started
  ON impersonation_sessions (impersonated_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active
  ON impersonation_sessions (ends_at)
  WHERE ended_at IS NULL;

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_sessions_admin_only ON impersonation_sessions;
CREATE POLICY impersonation_sessions_admin_only
  ON impersonation_sessions
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
