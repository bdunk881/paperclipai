-- HEL-credits-mvp — wholesale rate card for hosted-credits inference.
--
-- One row per (provider, model, effective_at). Lets ops hot-patch a
-- provider price change without redeploy. The code-side default rates
-- live in src/billing/credits/modelPricing.ts and are mirrored into
-- this table during migration application by the seed at the end.
--
-- `markup_multiplier` defaults to 1.50 per the launch decision (Phase 1
-- uniform 1.50× across all tiers). Per-tier overrides come in Phase 3
-- via the same column.
--
-- Read-only for normal request paths; writes happen via the admin
-- pricing endpoint (Phase 2+) or a follow-up migration.

CREATE TABLE IF NOT EXISTS hosted_model_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  input_usd_per_million numeric(10,4) NOT NULL CHECK (input_usd_per_million >= 0),
  cached_input_usd_per_million numeric(10,4) CHECK (cached_input_usd_per_million >= 0),
  cache_write_usd_per_million numeric(10,4) CHECK (cache_write_usd_per_million >= 0),
  output_usd_per_million numeric(10,4) NOT NULL CHECK (output_usd_per_million >= 0),
  markup_multiplier numeric(6,4) NOT NULL DEFAULT 1.50
    CHECK (markup_multiplier >= 1.0),
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (provider, model, effective_at)
);

CREATE INDEX IF NOT EXISTS idx_hosted_model_pricing_active
  ON hosted_model_pricing (provider, model)
  WHERE enabled = true AND superseded_at IS NULL;

-- Seed the rate card with the launch defaults (May 2026 wholesale prices).
-- Idempotent because the unique constraint includes effective_at; re-running
-- the migration won't insert duplicates as long as we hold effective_at
-- constant at the seed timestamp. We use a fixed seed timestamp so the
-- "current" row stays the same one across re-runs.
INSERT INTO hosted_model_pricing
  (provider, model, input_usd_per_million, cached_input_usd_per_million,
   cache_write_usd_per_million, output_usd_per_million, markup_multiplier,
   notes, effective_at)
VALUES
  -- Anthropic
  ('anthropic', 'claude-opus-4-7',           5.00, 0.50, 6.25, 25.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('anthropic', 'claude-sonnet-4-6',         3.00, 0.30, 3.75, 15.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('anthropic', 'claude-haiku-4-5',          1.00, 0.10, 1.25,  5.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('anthropic', 'claude-haiku-4-5-20251001', 1.00, 0.10, 1.25,  5.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  -- OpenAI
  ('openai',    'gpt-5.5',                   5.00, 2.50, NULL, 30.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('openai',    'gpt-5.4',                   2.50, 1.25, NULL, 15.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('openai',    'gpt-5.4-mini',              0.50, 0.25, NULL,  2.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('openai',    'gpt-5.4-nano',              0.20, 0.10, NULL,  0.80, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  -- Gemini
  ('gemini',    'gemini-3.5-flash',          1.50, 0.15, NULL,  9.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('gemini',    'gemini-3.1-flash-lite',     0.25, 0.05, NULL,  1.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('gemini',    'gemini-2.5-pro',            1.25, NULL, NULL, 10.00, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  -- DeepSeek
  ('deepseek',  'deepseek-v4-pro',           0.435, 0.0036, NULL, 0.87, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('deepseek',  'deepseek-v4-flash',         0.14,  0.0028, NULL, 0.28, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  -- Groq
  ('groq',      'llama-3.3-70b-versatile',   0.59, NULL, NULL, 0.79, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00'),
  ('groq',      'llama-3.1-8b-instant',      0.05, NULL, NULL, 0.08, 1.50, 'May 2026 wholesale', '2026-05-26 00:00:00+00')
ON CONFLICT (provider, model, effective_at) DO NOTHING;
