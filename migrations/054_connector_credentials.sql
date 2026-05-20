-- Migration 054: persistent encrypted connector credentials (HEL-180 Gap 1).
--
-- Before this migration: every connector credential store in src/integrations/
-- backs onto a process-local Map. AES-256-GCM encryption-at-rest is
-- implemented in each store, but it's theatre — credentials evaporate on
-- restart and don't cross workers. The same 30 lines of cipher code are
-- copy-pasted across 7+ connector stores.
--
-- After this migration: a single `connector_credentials` table holds all
-- connector OAuth + API-key credentials, encrypted at rest with the
-- workspace-wide `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`. The shared cipher
-- primitive lives at `src/integrations/_shared/cipher.ts`. The per-connector
-- credentialStore.ts files become thin CRUD shims over this table.
--
-- Scoping note: Slack today uses userId scoping (each user authorizes Slack
-- workspaces separately); this table preserves that. Future work
-- (separate ticket) re-scopes to workspace_id once the workspace context
-- plumbing reaches every connector route.

BEGIN;

CREATE TABLE IF NOT EXISTS connector_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identity (Supabase auth.users.id). Per-user-per-connector
  -- because Slack/Gmail/Linear OAuth grants are user-scoped, not
  -- workspace-scoped. This will be re-scoped to workspace_id later.
  user_id text NOT NULL,

  -- Connector key matches the directory name under src/integrations/.
  -- e.g. 'slack', 'linear', 'intercom', 'apollo', 'composio', etc.
  connector_key text NOT NULL,

  -- 'oauth2_pkce' | 'api_key' | future kinds. Free-text for forward
  -- compat; the per-connector service is the source of truth.
  auth_method text NOT NULL,

  -- The external account this credential authenticates to.
  -- For Slack: team_id; for Linear: organization_id; etc.
  external_account_id text,
  external_account_name text,

  -- Encrypted secrets — opaque ciphertext strings produced by
  -- `src/integrations/_shared/cipher.ts::encryptSecret()`. Format
  -- is `<iv_hex>:<tag_hex>:<ciphertext_hex>` for AES-256-GCM.
  token_encrypted text NOT NULL,
  -- Last 4 chars of the plaintext token, for UI display. Never
  -- contains anything that could be used to derive the full token.
  token_masked text NOT NULL,
  refresh_token_encrypted text,

  -- OAuth scopes granted by the upstream provider, stored as text[]
  -- so per-scope IN / array-contains queries are cheap.
  scopes text[] NOT NULL DEFAULT '{}',

  -- Free-form per-connector state (e.g. token expiry, integration
  -- version). Stored as JSON so we don't have to migrate the table
  -- every time a connector wants a new field.
  metadata_json jsonb NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Soft delete — the connector's `revoke()` flips this so we keep an
  -- audit trail of past authorizations without leaking secrets.
  revoked_at timestamptz
);

-- Fast lookup of "the current active credential for this user + connector"
-- (the common path) without a Seq Scan. Filtered partial index since the
-- common case excludes revoked rows.
CREATE INDEX IF NOT EXISTS connector_credentials_user_connector_active_idx
  ON connector_credentials (user_id, connector_key)
  WHERE revoked_at IS NULL;

-- Lookup by id+user for the "fetch this specific credential and confirm
-- the requesting user owns it" pattern used by service.ts entry points.
CREATE INDEX IF NOT EXISTS connector_credentials_id_user_idx
  ON connector_credentials (id, user_id);

-- updated_at maintained automatically — mirrors the trigger pattern used
-- across the other recently-migrated tables.
CREATE OR REPLACE FUNCTION connector_credentials_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connector_credentials_touch_updated_at ON connector_credentials;
CREATE TRIGGER connector_credentials_touch_updated_at
  BEFORE UPDATE ON connector_credentials
  FOR EACH ROW EXECUTE FUNCTION connector_credentials_touch_updated_at();

COMMIT;
