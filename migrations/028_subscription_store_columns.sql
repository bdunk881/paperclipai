-- Migration 028: Add subscriptionStore-required columns to subscriptions (HEL-45)
--
-- HEL-17 (migration 025) created `subscriptions` with the canonical workspace
-- + Stripe foreign keys, but the in-memory `subscriptionStore` tracks
-- additional fields the webhook handlers depend on:
--
--   user_id              — for getByUserId lookups
--   email                — for notifyCSM + customer-updated webhook
--   current_period_start — paired with the existing current_period_end
--   cancel_at_period_end — needed to render cancellation state
--   trial_end            — paired with status='trialing'
--   access_level         — derived enum surfaced to the client
--
-- HEL-45 makes subscriptionStore Postgres-backed; the table needs all of
-- these for round-trip parity with the in-memory shape.
--
-- workspace_id stays NOT NULL: HEL-17's final security iteration enforced
-- requireAuth on /api/billing/checkout, so every new subscription carries a
-- workspaceId. Pre-canonical legacy subscriptions live only in memory and
-- never make it to this table.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_end timestamptz,
  ADD COLUMN IF NOT EXISTS access_level text;

-- Constrain access_level to the enum the in-memory store uses. NULL allowed
-- for migration safety; new writes via subscriptionStore.upsert always set it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass
      AND conname = 'subscriptions_access_level_check'
  ) THEN
    ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_access_level_check;
  END IF;
  ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_access_level_check
    CHECK (access_level IS NULL OR access_level IN ('trial', 'active', 'past_due', 'cancelled', 'none'));
END$$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON subscriptions (user_id) WHERE user_id IS NOT NULL;

COMMIT;
