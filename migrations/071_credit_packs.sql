-- HEL-credits-mvp — credit pack SKUs and Stripe webhook idempotency.
--
-- `credit_packs` is the canonical catalog: how many credits each Stripe
-- Price gives the buyer, and the bonus-curve. Webhook handler reads this
-- to know how many credits to grant on a successful purchase.
--
-- Launch SKUs (all one-time Stripe Checkout sessions, no subscription):
--   pack_25  → $25  → 250,000 credits (+0%)
--   pack_50  → $50  → 525,000 credits (+5%)
--   pack_100 → $100 → 1,100,000 credits (+10%)
--   pack_250 → $250 → 2,875,000 credits (+15%)
--   pack_500 → $500 → 6,000,000 credits (+20%)
--
-- credit_purchase_events is a small idempotency log specific to the
-- credit-pack flow. The existing stripe_webhook_event_log dedupes by
-- event_id, but credit grants also need to dedupe by Stripe Checkout
-- session_id (because the synchronous confirm endpoint may credit the
-- wallet BEFORE the webhook arrives, and the webhook arriving second
-- must not double-credit). Both confirm and webhook write here with
-- ON CONFLICT DO NOTHING; the first writer wins, the second sees
-- the conflict and skips the grant.

CREATE TABLE IF NOT EXISTS credit_packs (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  stripe_price_id text NOT NULL UNIQUE,
  price_usd_cents integer NOT NULL CHECK (price_usd_cents > 0),
  credits_granted bigint NOT NULL CHECK (credits_granted > 0),
  bonus_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (bonus_percent >= 0),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_packs_enabled_sort
  ON credit_packs (sort_order)
  WHERE enabled = true;

-- Seed with the launch SKUs. Stripe Price IDs come from env vars at
-- deploy time and get patched in via a follow-up admin endpoint (the
-- Price IDs differ between Stripe live/test mode). We use placeholders
-- here so the catalog is queryable; pack-buy endpoints will refuse to
-- create a checkout session if the stripe_price_id is still a placeholder.
INSERT INTO credit_packs (id, display_name, stripe_price_id, price_usd_cents, credits_granted, bonus_percent, sort_order)
VALUES
  ('pack_25',  'Starter Pack',     'price_PLACEHOLDER_pack_25',   2500,   250000, 0,  10),
  ('pack_50',  'Plus Pack',        'price_PLACEHOLDER_pack_50',   5000,   525000, 5,  20),
  ('pack_100', 'Pro Pack',         'price_PLACEHOLDER_pack_100', 10000,  1100000, 10, 30),
  ('pack_250', 'Scale Pack',       'price_PLACEHOLDER_pack_250', 25000,  2875000, 15, 40),
  ('pack_500', 'Power Pack',       'price_PLACEHOLDER_pack_500', 50000,  6000000, 20, 50)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_purchase_events (
  stripe_session_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pack_id text NOT NULL REFERENCES credit_packs(id),
  credits_granted bigint NOT NULL,
  amount_usd_cents integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_via text NOT NULL CHECK (granted_via IN ('confirm_endpoint','webhook'))
);

CREATE INDEX IF NOT EXISTS idx_credit_purchase_events_workspace
  ON credit_purchase_events (workspace_id, granted_at DESC);
