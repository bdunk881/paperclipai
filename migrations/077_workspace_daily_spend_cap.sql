-- HEL-credits-mvp follow-up — per-workspace daily credit spend cap.
--
-- Self-service safety guardrail so a customer can hard-limit their own
-- daily credits-mode burn. Mirrors the platform-level
-- `platform_provider_keys.daily_spend_cap_usd` knob but on the
-- customer side: when set, reserveCredits checks the trailing-24h
-- consumption against this cap and refuses new reservations once
-- the cap is hit.
--
-- Null = no cap (default — most customers won't bother setting one).
-- 0 = effectively disable credit-mode usage for the day.
-- Positive integer = max credits/day.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS credits_daily_spend_cap_credits bigint
    CHECK (credits_daily_spend_cap_credits IS NULL OR credits_daily_spend_cap_credits >= 0);

COMMENT ON COLUMN workspaces.credits_daily_spend_cap_credits IS
  'Optional customer-set cap on trailing-24h credit consumption. When set, reserveCredits refuses to reserve once the trailing-24h total reaches this number. Null = no cap.';
