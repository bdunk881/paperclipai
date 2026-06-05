-- HEL-643: add claude-opus-4-8 to the hosted model rate card.
--
-- claude-opus-4-7 is retired as the Anthropic power/large default (tier routers
-- now point at 4-8). 4-8 is the current Opus, so the wholesale rate card needs a
-- row for it; rates mirror 4-7 until Anthropic publishes 4.8-specific pricing.
-- The 4-7 row (migration 070) is intentionally kept for historical cost lookups.
--
-- Same fixed effective_at style as 070 so the "current" row stays deterministic
-- across re-derivation. Filename-tracked, so this runs exactly once.
INSERT INTO hosted_model_pricing
  (provider, model, input_usd_per_million, cached_input_usd_per_million,
   cache_write_usd_per_million, output_usd_per_million, markup_multiplier,
   notes, effective_at)
VALUES
  ('anthropic', 'claude-opus-4-8',           5.00, 0.50, 6.25, 25.00, 1.50, 'HEL-643: current Opus, rates mirror 4-7', '2026-06-05 00:00:00+00');
