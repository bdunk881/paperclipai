-- HEL-credits-mvp Phase 3 — wallet auto-topup Stripe linkage.
--
-- Adds the two columns the auto-topup worker needs to fire an
-- off-session PaymentIntent on the customer's saved card:
--
--   * stripe_customer_id — created via Stripe Checkout in mode='setup'
--     when the customer adds their first auto-topup payment method.
--     Shared with subscription Stripe customers when the workspace
--     also has a subscription (per Stripe's recommendation — one
--     customer per workspace), but stored separately so wallet-only
--     workspaces aren't blocked on subscription bootstrap.
--   * stripe_payment_method_id — the default off-session PM. Captured
--     from setup_intent.succeeded webhook events.
--
-- The actual auto-topup config (enabled flag, trigger threshold,
-- amount) lives in the existing columns added by migration 067:
--   auto_topup_enabled, auto_topup_trigger_credits, auto_topup_amount_credits

ALTER TABLE workspace_credit_wallets
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id text;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_credit_wallets_stripe_customer_id_idx
  ON workspace_credit_wallets(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN workspace_credit_wallets.stripe_customer_id IS
  'Stripe Customer ID for off-session auto-topup PaymentIntents. Set by the setup_intent.succeeded webhook handler the first time the customer adds a card.';
COMMENT ON COLUMN workspace_credit_wallets.stripe_payment_method_id IS
  'Default Stripe PaymentMethod ID used by the auto-topup worker. Replaceable via the wallet setup-checkout flow.';
