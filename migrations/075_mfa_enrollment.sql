-- HEL-mfa-coverage-expansion: phish-resistant MFA across all accounts.
--
-- Supabase Auth natively supports TOTP and Phone factors but does NOT
-- expose WebAuthn / FIDO2. We bridge phish-resistant passkeys at the app
-- layer via SimpleWebAuthn, storing credentials in the public schema
-- alongside (not inside) auth.users. After a successful passkey assertion
-- the backend mints a short-lived AAL2 attestation cookie that
-- requireAAL2 will accept in place of a Supabase-issued aal2 JWT.
--
-- Tables:
--   mfa_webauthn_credentials — one row per registered passkey/security key
--   mfa_recovery_codes       — bcrypt-hashed printable codes (one-time-use)
--   user_mfa_policy          — per-user enrolled/required factor flags

-- ---------------------------------------------------------------------------
-- 1. WebAuthn credential storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_webauthn_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  credential_id   TEXT NOT NULL,
  public_key      BYTEA NOT NULL,
  sign_count      BIGINT NOT NULL DEFAULT 0,
  transports      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  device_name     TEXT,
  aaguid          UUID,
  backed_up       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  CONSTRAINT mfa_webauthn_credentials_credential_id_unique UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS mfa_webauthn_credentials_user_id_idx
  ON mfa_webauthn_credentials (user_id);

COMMENT ON TABLE mfa_webauthn_credentials IS
  'WebAuthn/FIDO2 credentials registered by users for phish-resistant MFA. credential_id is the base64url-encoded credential ID returned by the authenticator; public_key stores the COSE-encoded public key for assertion verification.';

-- ---------------------------------------------------------------------------
-- 2. Recovery codes (one-time-use, bcrypt-hashed at rest)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  code_hash   TEXT NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_id_idx
  ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;

COMMENT ON TABLE mfa_recovery_codes IS
  'Printable one-time-use recovery codes issued at MFA enrollment. Stored as bcrypt hashes (rounds=10) so plaintext never persists. Plaintext is returned exactly once at generation; lost codes require regenerate (which invalidates all prior codes).';

-- ---------------------------------------------------------------------------
-- 3. Per-user MFA policy + bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mfa_policy (
  user_id              UUID PRIMARY KEY,
  has_webauthn         BOOLEAN NOT NULL DEFAULT FALSE,
  has_totp             BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_codes_issued_at TIMESTAMPTZ,
  enrollment_completed_at  TIMESTAMPTZ,
  last_verified_at     TIMESTAMPTZ,
  last_verified_method TEXT
    CHECK (last_verified_method IS NULL
           OR last_verified_method IN ('webauthn', 'totp', 'recovery_code')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_mfa_policy IS
  'Per-user MFA bookkeeping: which factor types are enrolled, when recovery codes were last issued, and the timestamp/method of the most recent successful verification. Used by the enforcement gate (frontend) and requireAAL2 middleware (backend).';

-- ---------------------------------------------------------------------------
-- 4. Trigger to keep user_mfa_policy.updated_at fresh
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_mfa_policy_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_mfa_policy_set_updated_at ON user_mfa_policy;
CREATE TRIGGER user_mfa_policy_set_updated_at
  BEFORE UPDATE ON user_mfa_policy
  FOR EACH ROW EXECUTE FUNCTION user_mfa_policy_touch_updated_at();
