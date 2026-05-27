-- HEL-267 — subscription_tiers catalog (PR1 of DB-driven pricing tiers).
--
-- Replaces three diverging hardcoded copies of the tier ladder:
--   - src/billing/stripeClient.ts (PRICING_TIERS const)
--   - landing/app/page.tsx        (local marketing copy, drifted to "Tinker")
--   - landing/lib/stripe.ts       (third copy)
--
-- This is the canonical catalog. The public GET /api/public/landing/pricing
-- endpoint joins this with credit_packs (071) so the landing page and
-- dashboard can render everything from one fetch.
--
-- Confirmed tier ladder (Brad, 2026-05-27):
--   explore  → $0/mo    free tier, no Stripe price
--   flow     → $19/mo   14-day trial
--   automate → $49/mo   14-day trial, "Most popular"
--   scale    → $99/mo   no trial, talk-to-sales CTA
--
-- stripe_price_env stores the env-var name to resolve at runtime (e.g.
-- 'STRIPE_FLOW_PRICE_ID'). Live IDs differ between Stripe test/live mode
-- so we resolve from process.env rather than baking IDs into the DB.

CREATE TABLE IF NOT EXISTS subscription_tiers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  price_usd_cents integer NOT NULL CHECK (price_usd_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  stripe_price_env text,
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  sort_order integer NOT NULL DEFAULT 100,
  is_popular boolean NOT NULL DEFAULT false,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_label text NOT NULL DEFAULT 'Choose plan',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_tiers_enabled_sort
  ON subscription_tiers (sort_order)
  WHERE enabled = true;

-- Seed with the 4 confirmed tiers. Feature lists are placeholders;
-- marketing will refine before public launch. CTAs match current
-- landing-page convention.
INSERT INTO subscription_tiers
  (id, display_name, price_usd_cents, stripe_price_env, trial_days, sort_order, is_popular, features, cta_label)
VALUES
  ('explore', 'Explore', 0, NULL, 0, 10, false,
    '["3 workspaces", "Daily Sonnet credit cap", "Community support"]'::jsonb,
    'Get started'),
  ('flow', 'Flow', 1900, 'STRIPE_FLOW_PRICE_ID', 14, 20, false,
    '["Everything in Explore", "Unlimited workspaces", "5,000 daily Sonnet credits", "Priority email support"]'::jsonb,
    'Start 14-day trial'),
  ('automate', 'Automate', 4900, 'STRIPE_AUTOMATE_PRICE_ID', 14, 30, true,
    '["Everything in Flow", "20,000 daily credits", "Opus model access", "Slack support", "Custom approval policies"]'::jsonb,
    'Start 14-day trial'),
  ('scale', 'Scale', 9900, 'STRIPE_SCALE_PRICE_ID', 0, 40, false,
    '["Everything in Automate", "Unlimited daily credits", "SSO + audit logs", "Dedicated success manager", "Custom SLAs"]'::jsonb,
    'Talk to sales')
ON CONFLICT (id) DO NOTHING;
