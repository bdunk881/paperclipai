-- HEL-credits-mvp (Phase 3) — per-workspace markup override.
--
-- Lets ops carve out enterprise discounts without touching the global
-- `hosted_model_pricing.markup_multiplier` default. When a workspace
-- has `credits_markup_override` set, costCalculator uses THAT value
-- instead of the model rate's default; null falls through to the
-- normal 1.50× launch multiplier.
--
-- Read by src/billing/credits/costCalculator.ts on every credits-mode
-- call. Written via an admin endpoint (TBD) or a follow-up migration.
-- Constrained to [0.5, 5.0] so an accidental zero can't free-credit
-- the planet and an accidental 99× can't crater conversion.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS credits_markup_override numeric(6,4)
    CHECK (credits_markup_override IS NULL
           OR (credits_markup_override >= 0.5 AND credits_markup_override <= 5.0));

COMMENT ON COLUMN workspaces.credits_markup_override IS
  'Per-workspace override of hosted_model_pricing.markup_multiplier. Null = use the model rate default (1.50×). Enterprise carve-outs are typically in the 1.10–1.30 range.';
