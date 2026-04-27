BEGIN;

CREATE TABLE IF NOT EXISTS auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  email_normalized text,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NULL OR email_normalized IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_normalized_key
  ON auth_users (email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_user_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'apple')),
  provider_subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  provider_email text,
  provider_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_identities_user_id
  ON auth_user_identities (user_id);

COMMIT;
