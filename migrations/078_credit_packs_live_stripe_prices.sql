-- HEL-credits-mvp — backfill credit_packs.stripe_price_id with live IDs.
--
-- Migration 071 seeded the credit_packs rows with `price_PLACEHOLDER_*`
-- sentinels. checkoutRoutes.ts refuses to mint Stripe Checkout sessions
-- until those are replaced with real Stripe price IDs. This migration
-- ships the live IDs from acct_1THYp5LdsQqpbPtj ("AutoFlow") created
-- via the Stripe MCP on 2026-05-27.
--
-- The Products + Prices live in the production Stripe account; the
-- subscription tier products (prod_UJ1U*) already live there too, so
-- credit-pack pricing rides on the same account.
--
-- Audit:
--   pack_25  → price_1TblvLLdsQqpbPtjS1dQo7ET → prod_Uaxp8YX8nK8qv1 (Starter, $25)
--   pack_50  → price_1TblvLLdsQqpbPtj31c4eu9Y → prod_Uaxp2hXGIEESLU (Plus, $50)
--   pack_100 → price_1TblvMLdsQqpbPtjtpN0xq0s → prod_UaxpCCcnkcVpmq (Pro, $100)
--   pack_250 → price_1TblvMLdsQqpbPtjRL3AbmU0 → prod_UaxpJykjHkNsHf (Scale, $250)
--   pack_500 → price_1TblvNLdsQqpbPtj7ry7CmwZ → prod_UaxpAGY6Fo8wrJ (Power, $500)
--
-- The UPDATEs are guarded by `WHERE stripe_price_id LIKE 'price_PLACEHOLDER_%'`
-- so this migration is a no-op on environments that already have real
-- price IDs (e.g. a staging clone where the same migration already ran).

UPDATE credit_packs
   SET stripe_price_id = 'price_1TblvLLdsQqpbPtjS1dQo7ET'
 WHERE id = 'pack_25' AND stripe_price_id LIKE 'price_PLACEHOLDER_%';

UPDATE credit_packs
   SET stripe_price_id = 'price_1TblvLLdsQqpbPtj31c4eu9Y'
 WHERE id = 'pack_50' AND stripe_price_id LIKE 'price_PLACEHOLDER_%';

UPDATE credit_packs
   SET stripe_price_id = 'price_1TblvMLdsQqpbPtjtpN0xq0s'
 WHERE id = 'pack_100' AND stripe_price_id LIKE 'price_PLACEHOLDER_%';

UPDATE credit_packs
   SET stripe_price_id = 'price_1TblvMLdsQqpbPtjRL3AbmU0'
 WHERE id = 'pack_250' AND stripe_price_id LIKE 'price_PLACEHOLDER_%';

UPDATE credit_packs
   SET stripe_price_id = 'price_1TblvNLdsQqpbPtj7ry7CmwZ'
 WHERE id = 'pack_500' AND stripe_price_id LIKE 'price_PLACEHOLDER_%';
