-- HEL-credits-mvp — Hosted Inference Credits (Phase 1).
--
-- Introduces the per-workspace credit wallet that funds platform-routed
-- LLM calls. Customers buy credit packs via Stripe one-time checkout (see
-- migration 070 for the SKU catalog and the new "credits" mode column on
-- workspaces in this migration's tail). The wallet's `balance_credits`
-- is debited atomically at call time via the reserve/commit/release RPCs
-- defined further down the file.
--
-- Unit: 1 credit = $0.0001 of marked-up cost (10,000 credits = $1.00).
-- Integer cents math throughout — no float drift in the ledger.

CREATE TABLE IF NOT EXISTS workspace_credit_wallets (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  balance_credits bigint NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  lifetime_purchased_credits bigint NOT NULL DEFAULT 0,
  lifetime_consumed_credits bigint NOT NULL DEFAULT 0,
  low_balance_alert_threshold_credits bigint,
  auto_topup_enabled boolean NOT NULL DEFAULT false,
  auto_topup_trigger_credits bigint,
  auto_topup_amount_credits bigint,
  auto_topup_stripe_pm_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credit_wallets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_credit_wallets_tenant_isolation ON workspace_credit_wallets;
CREATE POLICY workspace_credit_wallets_tenant_isolation
ON workspace_credit_wallets
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- Funding mode on the workspace itself. `byok` = caller's own LLM keys;
-- `credits` = platform-routed via the wallet; `hybrid` = try BYOK first,
-- fall back to credits.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS llm_funding_mode text NOT NULL DEFAULT 'byok'
    CHECK (llm_funding_mode IN ('byok','credits','hybrid')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_customer
  ON workspaces (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
