-- HEL-395: tie passkeys to their owner so deleting a user can't orphan them.
--
-- 075_mfa_enrollment.sql created mfa_webauthn_credentials with `user_id UUID
-- NOT NULL` but deliberately NO foreign key — credentials live "alongside (not
-- inside) auth.users". The cost of that decoupling: when a Supabase user is
-- deleted, their passkey rows survive with a dangling user_id. The
-- discoverable-credential picker still offers those passkeys, but passwordless
-- login (supabaseSessionMinter.mintSupabaseSessionForUser → getUserById) then
-- 404s on the missing user and dead-ends (HEL-393 → HEL-394). In dev this
-- orphaned 4 of 6 credentials.
--
-- Add the FK with ON DELETE CASCADE so a user deletion cleans up its passkeys
-- and orphans become impossible.
--
-- NOTE on auth.users: bare-Postgres dev/CI environments have no `auth` schema,
-- so — exactly like migrations 063 and 093 — both the orphan cleanup (its
-- subquery hits auth.users) and the FK live inside a guard that only fires when
-- the real Supabase `auth.users` table is present. Auth-less envs skip both.
-- Idempotent so re-runs are safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'auth' AND c.relname = 'users' AND c.relkind = 'r'
  ) THEN
    -- 1. Defensive cleanup — drop any pre-existing orphans so the FK can attach.
    DELETE FROM mfa_webauthn_credentials c
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id);

    -- 2. Cascading FK, skipped if it already exists.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'mfa_webauthn_credentials_user_id_fkey'
    ) THEN
      ALTER TABLE mfa_webauthn_credentials
        ADD CONSTRAINT mfa_webauthn_credentials_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
