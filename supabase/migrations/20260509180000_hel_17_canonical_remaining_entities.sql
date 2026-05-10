-- HEL-17: Remaining canonical entities — Supabase-managed schema.
-- Mirrors migrations/022_canonical_remaining_entities.sql for Supabase deploys.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.connector_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  ON public.connector_connections (workspace_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_connector_connections_last_used
  ON public.connector_connections (workspace_id, last_used_at DESC);

ALTER TABLE public.connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_connections_tenant_isolation ON public.connector_connections;
CREATE POLICY connector_connections_tenant_isolation
ON public.connector_connections
USING (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
)
WITH CHECK (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
);

CREATE TABLE IF NOT EXISTS public.llm_credentials (
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

ALTER TABLE public.llm_credentials
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS key_ref text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'llm_credentials_status_check'
      AND conrelid = 'public.llm_credentials'::regclass
  ) THEN
    ALTER TABLE public.llm_credentials
      ADD CONSTRAINT llm_credentials_status_check
      CHECK (status IN ('pending', 'valid', 'invalid', 'revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_llm_credentials_workspace_provider
  ON public.llm_credentials (workspace_id, provider, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_credentials_key_ref
  ON public.llm_credentials (key_ref)
  WHERE key_ref IS NOT NULL;

ALTER TABLE public.llm_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_credentials_workspace_tenant_isolation ON public.llm_credentials;
CREATE POLICY llm_credentials_workspace_tenant_isolation
ON public.llm_credentials
USING (
  (
    workspace_id IS NULL
    AND public.app_current_user_id() IS NOT NULL
    AND user_id = public.app_current_user_id()
  )
  OR (
    public.app_current_workspace_id() IS NOT NULL
    AND workspace_id = public.app_current_workspace_id()
  )
)
WITH CHECK (
  (
    workspace_id IS NULL
    AND public.app_current_user_id() IS NOT NULL
    AND user_id = public.app_current_user_id()
  )
  OR (
    public.app_current_workspace_id() IS NOT NULL
    AND workspace_id = public.app_current_workspace_id()
  )
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  ON public.budgets (workspace_id, scope_kind, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), period);
CREATE INDEX IF NOT EXISTS idx_budgets_workspace_period
  ON public.budgets (workspace_id, period);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_tenant_isolation ON public.budgets;
CREATE POLICY budgets_tenant_isolation
ON public.budgets
USING (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
)
WITH CHECK (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
);

CREATE OR REPLACE FUNCTION public.check_budget(
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
      FROM public.budgets
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

CREATE OR REPLACE FUNCTION public.reserve_budget_cents(
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

  UPDATE public.budgets
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

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  plan text NOT NULL CHECK (plan IN ('explore', 'flow', 'automate', 'scale')),
  status text NOT NULL,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace
  ON public.subscriptions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_tenant_isolation ON public.subscriptions;
CREATE POLICY subscriptions_tenant_isolation
ON public.subscriptions
USING (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
)
WITH CHECK (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
);

CREATE TABLE IF NOT EXISTS public.entitlements (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  runs_per_month integer NOT NULL CHECK (runs_per_month >= 0),
  agent_cap integer NOT NULL CHECK (agent_cap >= 0),
  integration_cap integer NOT NULL CHECK (integration_cap >= 0),
  byok_allowed boolean NOT NULL DEFAULT false,
  log_retention_days integer NOT NULL CHECK (log_retention_days >= 1),
  approval_tier_max integer NOT NULL CHECK (approval_tier_max >= 0),
  plan text NOT NULL DEFAULT 'explore' CHECK (plan IN ('explore', 'flow', 'automate', 'scale')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entitlements_tenant_isolation ON public.entitlements;
CREATE POLICY entitlements_tenant_isolation
ON public.entitlements
USING (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
)
WITH CHECK (
  public.app_current_workspace_id() IS NOT NULL
  AND workspace_id = public.app_current_workspace_id()
);

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS target_kind text,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

-- audit_log carries an append-only RLS policy from the rename in 021. Drop
-- the no-update / no-delete policies, run the backfill, recreate them.
-- set_config('row_security','off') does NOT bypass FORCE RLS so the previous
-- attempt would still abort the migration under non-BYPASSRLS roles.
DROP POLICY IF EXISTS audit_log_no_update ON public.audit_log;
DROP POLICY IF EXISTS audit_log_no_delete ON public.audit_log;

UPDATE public.audit_log
SET
  target_kind = COALESCE(target_kind, target_type),
  payload = COALESCE(payload, metadata),
  occurred_at = COALESCE(occurred_at, at)
WHERE target_kind IS NULL
   OR payload IS NULL
   OR occurred_at IS NULL;

CREATE POLICY audit_log_no_update
  ON public.audit_log
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY audit_log_no_delete
  ON public.audit_log
  FOR DELETE
  USING (false);

ALTER TABLE public.audit_log
  ALTER COLUMN occurred_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.sync_audit_log_canonical_columns()
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

DROP TRIGGER IF EXISTS trg_audit_log_sync_canonical_columns ON public.audit_log;
CREATE TRIGGER trg_audit_log_sync_canonical_columns
BEFORE INSERT OR UPDATE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.sync_audit_log_canonical_columns();

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS control_plane_audit_log_category_check;
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_category_check;
ALTER TABLE public.audit_log
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
  ON public.audit_log (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_kind_id
  ON public.audit_log (workspace_id, target_kind, target_id);
