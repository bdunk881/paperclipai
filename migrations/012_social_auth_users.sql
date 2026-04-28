BEGIN;

CREATE TABLE IF NOT EXISTS social_auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text,
  provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'apple')),
  provider_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_auth_users_email
  ON social_auth_users (email);

COMMIT;
