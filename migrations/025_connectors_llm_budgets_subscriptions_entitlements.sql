-- Migration 025: Canonical connector_connections, llm_credentials extension,
-- budgets, subscriptions, entitlements (HEL-17)
--
-- Audit outcome:
--   * llm_credentials  — table already exists (renamed from llm_configs in 021).
--                        Extends with canonical workspace_id + key_ref + validated_at
--                        + status. Existing user-keyed rows kept intact (workspace_id
--                        nullable until a backfill ticket runs).
--   * connector_connections — NEW canonical. Coexists with the legacy
--                        connector_credentials table.
--   * budgets          — NEW. Per-workspace + per-agent caps with period rollover.
--   * subscriptions    — NEW. Mirrors Stripe subscription state per workspace.
--   * entitlements     — NEW. Workspace-level feature/quota gates derived from
--                        the active subscription tier (drives requireEntitlement()).
--   * audit_log        — already canonical (renamed in 021). No-op here.

BEGIN;

-- ============================================================
-- llm_credentials extension
-- ============================================================
-- Existing columns: id text, user_id text, provider, label, model,
--   api_key_encrypted, api_key_masked, is_default, created_at.
-- Add the canonical fields. Backfill ticket assigns workspace_id and key_ref
-- for existing rows; new rows are expected to populate them at insert time.
ALTER TABLE llm_credentials
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS key_ref text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invalid', 'rotated', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_llm_credentials_workspace_id
  ON llm_credentials (workspace_id) WHERE workspace_id IS NOT NULL;

-- RLS — only enforce on rows that have a workspace_id set (new canonical rows).
-- Legacy rows scoped only by user_id remain accessible to that user via the
-- existing application-level filter. Once the backfill ticket lands, this
-- policy hardens to require workspace_id IS NOT NULL.
ALTER TABLE llm_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_credentials_tenant_isolation ON llm_credentials;
CREATE POLICY llm_credentials_tenant_isolation
ON llm_credentials
USING (
  -- Pass legacy rows through (workspace_id NULL) to avoid breaking existing
  -- user-keyed access until backfill. Workspace-scoped rows enforce the
  -- canonical isolation.
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  workspace_id IS NULL
  OR (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  )
);

-- ============================================================
-- connector_connections (canonical)
-- ============================================================
-- Coexists with connector_credentials (006). Code-path migration is a
-- follow-up — the legacy table stays the active store for now.
CREATE TABLE IF NOT EXISTS connector_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- e.g. 'slack', 'gmail', 'hubspot', 'linear', 'github', 'stripe', 'apollo',
  -- 'notion'. Free-form so we can add connectors without schema migrations.
  kind text NOT NULL,
  -- Pointer to the actual OAuth token in the secrets manager. The token
  -- itself never lives in the database.
  oauth_token_ref text,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'revoked', 'failed', 'pending')),
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_workspace_id
  ON connector_connections (workspace_id);
CREATE INDEX IF NOT EXISTS idx_connector_connections_status
  ON connector_connections (workspace_id, status);

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
-- budgets (canonical)
-- ============================================================
-- Spend cap per workspace or per agent, enforced before each LLM/tool call.
-- Period rollover is handled by the engine reading current-period spend from
-- spend_entries (already canonical from 021).
CREATE TABLE IF NOT EXISTS budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('workspace', 'agent')),
  -- For workspace scope, scope_id matches workspace_id. For agent scope it
  -- references agents(id). Polymorphic to keep the table simple.
  scope_id uuid NOT NULL,
  cap_cents integer NOT NULL CHECK (cap_cents >= 0),
  period text NOT NULL DEFAULT 'monthly'
    CHECK (period IN ('daily', 'weekly', 'monthly', 'lifetime')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope_kind, scope_id, period)
);

CREATE INDEX IF NOT EXISTS idx_budgets_workspace_id
  ON budgets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_budgets_scope
  ON budgets (scope_kind, scope_id);

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

-- ============================================================
-- subscriptions (mirrors Stripe state)
-- ============================================================
-- Updated by src/billing/stripeWebhook.ts on every customer.subscription.*
-- and invoice.* event. Source of truth for tier; entitlements derived from it.
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- Tier names match landing pricing: Flow / Automate / Scale.
  tier text NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'flow', 'automate', 'scale', 'enterprise')),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription
  ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);

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

-- ============================================================
-- entitlements (feature/quota gates derived from subscription tier)
-- ============================================================
-- Read by requireEntitlement() middleware before allowing a workflow run,
-- agent provision, integration install, etc. One row per (workspace, feature).
-- Producer of state: stripeWebhook.ts on subscription change resolves the
-- tier → feature mapping and upserts here.
CREATE TABLE IF NOT EXISTS entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature text NOT NULL,
  -- Quantitative limits (NULL = unlimited).
  limit_value integer CHECK (limit_value IS NULL OR limit_value >= 0),
  -- Boolean toggles.
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'subscription'
    CHECK (source IN ('subscription', 'override', 'trial', 'comp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, feature)
);

-- Standard feature keys (documented inline so future readers don't
-- have to grep code):
--   workflow_runs_per_month        — integer cap
--   agents_max                     — integer cap
--   integrations_max               — integer cap
--   byok_allowed                   — boolean
--   approvals_tier_policy          — boolean (requires Automate+)
--   log_retention_days             — integer
--   sso_saml                       — boolean (Scale only)

CREATE INDEX IF NOT EXISTS idx_entitlements_workspace_id
  ON entitlements (workspace_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_feature
  ON entitlements (feature);

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

COMMIT;
