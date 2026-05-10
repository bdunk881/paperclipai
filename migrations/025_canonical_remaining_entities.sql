-- Migration 022: Remaining canonical entities (HEL-17)
--
-- Adds the last workspace-scoped canonical foundation tables:
-- connector_connections, budgets, subscriptions, and entitlements.
-- It also brings the pre-existing llm_credentials and audit_log tables forward
-- without breaking legacy app code that still reads their older columns.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- connector_connections
-- ============================================================

CREATE TABLE IF NOT EXISTS connector_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  oauth_token_ref text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'needs_reauth', 'revoked', 'error')),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, oauth_token_ref)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_workspace_kind
  ON connector_connections (workspace_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_connector_connections_last_used
  ON connector_connections (workspace_id, last_used_at DESC);

ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_connections_tenant_isolation ON connector_connections;
CREATE POLICY connector_connections_tenant_isolation
ON connector_connections
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- llm_credentials canonical columns
-- ============================================================
-- migration 021 renamed llm_configs -> llm_credentials. Keep those legacy
-- columns for runtime compatibility, but add the canonical workspace/BYOK
-- columns required by HEL-17.

CREATE TABLE IF NOT EXISTS llm_credentials (
  id text PRIMARY KEY,
  user_id text,
  provider text NOT NULL,
  label text,
  model text,
  api_key_encrypted text,
  api_key_masked text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE llm_credentials
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS key_ref text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'llm_credentials_status_check'
      AND conrelid = 'llm_credentials'::regclass
  ) THEN
    ALTER TABLE llm_credentials
      ADD CONSTRAINT llm_credentials_status_check
      CHECK (status IN ('pending', 'valid', 'invalid', 'revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_llm_credentials_workspace_provider
  ON llm_credentials (workspace_id, provider, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_credentials_key_ref
  ON llm_credentials (key_ref)
  WHERE key_ref IS NOT NULL;

ALTER TABLE llm_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_credentials_workspace_tenant_isolation ON llm_credentials;
CREATE POLICY llm_credentials_workspace_tenant_isolation
ON llm_credentials
USING (
  (
    workspace_id IS NULL
    AND app_current_user_id() IS NOT NULL
    AND user_id = app_current_user_id()
  )
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  (
    workspace_id IS NULL
    AND app_current_user_id() IS NOT NULL
    AND user_id = app_current_user_id()
  )
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
);

-- ============================================================
-- budgets
-- ============================================================

CREATE TABLE IF NOT EXISTS budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('workspace', 'agent')),
  scope_id uuid,
  cap_cents integer NOT NULL CHECK (cap_cents >= 0),
  period text NOT NULL,
  used_cents integer NOT NULL DEFAULT 0 CHECK (used_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_kind = 'workspace' AND scope_id IS NULL)
    OR (scope_kind = 'agent' AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_workspace_scope_period
  ON budgets (workspace_id, scope_kind, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), period);
CREATE INDEX IF NOT EXISTS idx_budgets_workspace_period
  ON budgets (workspace_id, period);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_tenant_isolation ON budgets;
CREATE POLICY budgets_tenant_isolation
ON budgets
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- O(1) indexed budget gates for API/runtime callers. The unique expression
-- index above makes these point lookups independent of spend-ledger size.
CREATE OR REPLACE FUNCTION check_budget(
  p_workspace_id uuid,
  p_scope_kind text,
  p_scope_id uuid,
  p_period text,
  p_delta_cents integer DEFAULT 0
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT used_cents + GREATEST(p_delta_cents, 0) <= cap_cents
      FROM budgets
      WHERE workspace_id = p_workspace_id
        AND scope_kind = p_scope_kind
        AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND period = p_period
      LIMIT 1
    ),
    true
  )
$$;

CREATE OR REPLACE FUNCTION reserve_budget_cents(
  p_workspace_id uuid,
  p_scope_kind text,
  p_scope_id uuid,
  p_period text,
  p_delta_cents integer
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_delta_cents < 0 THEN
    RAISE EXCEPTION 'p_delta_cents must be non-negative';
  END IF;

  UPDATE budgets
  SET used_cents = used_cents + p_delta_cents,
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND scope_kind = p_scope_kind
    AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND period = p_period
    AND used_cents + p_delta_cents <= cap_cents;

  RETURN FOUND;
END;
$$;

-- ============================================================
-- subscriptions + entitlements
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  plan text NOT NULL CHECK (plan IN ('explore', 'flow', 'automate', 'scale')),
  status text NOT NULL,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace
  ON subscriptions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_tenant_isolation ON subscriptions;
CREATE POLICY subscriptions_tenant_isolation
ON subscriptions
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

CREATE TABLE IF NOT EXISTS entitlements (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  runs_per_month integer NOT NULL CHECK (runs_per_month >= 0),
  agent_cap integer NOT NULL CHECK (agent_cap >= 0),
  integration_cap integer NOT NULL CHECK (integration_cap >= 0),
  byok_allowed boolean NOT NULL DEFAULT false,
  log_retention_days integer NOT NULL CHECK (log_retention_days >= 1),
  approval_tier_max integer NOT NULL CHECK (approval_tier_max >= 0),
  plan text NOT NULL DEFAULT 'explore' CHECK (plan IN ('explore', 'flow', 'automate', 'scale')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entitlements_tenant_isolation ON entitlements;
CREATE POLICY entitlements_tenant_isolation
ON entitlements
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ============================================================
-- audit_log canonical aliases and privileged categories
-- ============================================================

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS target_kind text,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

-- audit_log carries a FORCE-RLS append-only policy (FOR UPDATE USING (false)
-- + FOR DELETE USING (false)) inherited from the rename in 021. Applying
-- the canonical-column backfill UPDATE under a non-BYPASSRLS migration role
-- would fail the policy check and abort the migration transaction. Disable
-- row_security for this single operation, then restore.
DO $$
BEGIN
  PERFORM set_config('row_security', 'off', true);
  UPDATE audit_log
  SET
    target_kind = COALESCE(target_kind, target_type),
    payload = COALESCE(payload, metadata),
    occurred_at = COALESCE(occurred_at, at)
  WHERE target_kind IS NULL
     OR payload IS NULL
     OR occurred_at IS NULL;
  PERFORM set_config('row_security', 'on', true);
END$$;

ALTER TABLE audit_log
  ALTER COLUMN occurred_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION sync_audit_log_canonical_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.target_kind := COALESCE(NEW.target_kind, NEW.target_type);
  NEW.target_type := COALESCE(NEW.target_type, NEW.target_kind);
  NEW.payload := COALESCE(NEW.payload, NEW.metadata);
  NEW.metadata := COALESCE(NEW.metadata, NEW.payload);
  NEW.occurred_at := COALESCE(NEW.occurred_at, NEW.at, now());
  NEW.at := COALESCE(NEW.at, NEW.occurred_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_sync_canonical_columns ON audit_log;
CREATE TRIGGER trg_audit_log_sync_canonical_columns
BEFORE INSERT OR UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION sync_audit_log_canonical_columns();

ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS control_plane_audit_log_category_check;
ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_category_check;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_category_check
  CHECK (
    category IN (
      'secret',
      'provisioning',
      'team_lifecycle',
      'agent_lifecycle',
      'execution',
      'auth',
      'bypass_attempt',
      'billing',
      'entitlement',
      'connector_connection',
      'llm_credential',
      'budget'
    )
  );

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_occurred
  ON audit_log (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_kind_id
  ON audit_log (workspace_id, target_kind, target_id);

COMMIT;
