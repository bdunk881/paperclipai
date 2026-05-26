-- HEL-credits-mvp — pool of platform-owned LLM key sources.
--
-- "Key source" is the abstraction: a single row can be an OpenRouter
-- prepaid account (Phase 1) OR a direct provider key (Phase 2+).
-- `source_kind` tells creditsRouter.ts which wire path to use without
-- hardcoding the topology. At Phase 1 launch this table has ONE row:
-- the platform's OpenRouter API key, with source_kind='openrouter' and
-- priority=100. When Phase 2 adds a direct Anthropic account it lands
-- as a second row with source_kind='direct', provider='anthropic',
-- priority=10 (lower wins) and the credits router starts preferring it.
--
-- key_ciphertext is encrypted with the existing connectorSecretVault
-- (src/integrations/shared/credentialRegistry.ts) so it shares the
-- same key-rotation story as customer BYOK credentials.
--
-- NOT workspace-scoped — this is platform-shared infra. RLS is disabled
-- on the table but the app_api role only reaches it through the service
-- code path in src/billing/credits/keySourceStore.ts (no direct SELECT
-- from per-tenant routes).

CREATE TABLE IF NOT EXISTS platform_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('openrouter','direct')),
  provider text NOT NULL,
  label text NOT NULL,
  key_ciphertext text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','throttled','low_balance','disabled','retired')),
  throttled_until timestamptz,
  prepaid_balance_usd numeric(12,2),
  prepaid_balance_observed_at timestamptz,
  daily_spend_cap_usd numeric(12,2),
  current_day_spend_usd numeric(12,4) NOT NULL DEFAULT 0,
  current_day_key text,
  last_429_at timestamptz,
  consecutive_429_count integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, label),
  -- An OpenRouter row's provider field must be the string 'openrouter';
  -- the per-provider lookup match for OpenRouter happens via source_kind.
  CHECK (
    (source_kind = 'openrouter' AND provider = 'openrouter')
    OR source_kind = 'direct'
  )
);

CREATE INDEX IF NOT EXISTS idx_platform_provider_keys_lookup
  ON platform_provider_keys (provider, status, priority, id);
CREATE INDEX IF NOT EXISTS idx_platform_provider_keys_openrouter
  ON platform_provider_keys (status, priority, id)
  WHERE source_kind = 'openrouter';
