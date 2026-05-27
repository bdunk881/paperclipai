-- HEL-269 — subscription_tiers polish for landing wire-up (PR3).
--
-- 1. Add price_unit column so Automate/Scale can show "/seat/mo" while
--    Explore/Flow stay on "/mo". The landing has displayed this distinction
--    since the v2 redesign; HEL-267 dropped it when going DB-driven because
--    the schema had no equivalent field.
--
-- 2. Update Scale's cta_label from "Talk to sales" to "Choose Scale" since
--    PR3 routes Scale through Stripe Checkout like the other paid tiers
--    (the DB row already has stripe_price_env = STRIPE_SCALE_PRICE_ID, so
--    self-serve was always possible — only the landing CTA was sales-led).

ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS price_unit text NOT NULL DEFAULT '/mo';

UPDATE subscription_tiers
  SET price_unit = '/seat/mo'
  WHERE id IN ('automate', 'scale');

UPDATE subscription_tiers
  SET cta_label = 'Choose Scale'
  WHERE id = 'scale' AND cta_label = 'Talk to sales';
