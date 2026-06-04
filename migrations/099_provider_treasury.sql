-- HEL-599 — Stripe Issuing treasury layer: per-provider virtual cards +
-- append-only wholesale-funding ledger.
--
-- This is the treasury job OpenRouter runs for us today, insourced for the
-- direct providers (Anthropic, OpenAI). Two platform-infra tables — NOT
-- workspace-scoped, same class as platform_provider_keys (migration 069):
--
--   provider_issuing_cards   — one Stripe Issuing virtual card per direct
--                              provider. Holds the Stripe card/cardholder
--                              ids, the per-card hard monthly cap, and the
--                              native auto-reload knobs. The card PAN is
--                              NEVER stored here (only last_four for display);
--                              the live number/cvc are fetched on demand from
--                              Stripe for the one-time "put on file at the
--                              provider console" step. Rows are created at
--                              runtime by stripeIssuing.ensureProviderCards()
--                              (needs live Stripe API calls), not seeded here.
--
--   provider_treasury_ledger — append-only audit ledger paralleling
--                              workspace_credit_ledger (migration 068). One
--                              row per Issuing-balance funding sweep and per
--                              provider-card authorization / capture / refund /
--                              decline, so wholesale funding is auditable and
--                              reconcilable per provider. `idempotency_key`
--                              dedupes Stripe webhook retries + purchase-sweep
--                              retries, exactly like the credit ledger.
--
-- RLS mirrors platform_provider_keys (migration 084's "admin-only" pattern):
-- the backend reaches these via the BYPASSRLS pool (DATABASE_URL) on the
-- service path in src/billing/credits/treasuryLedgerStore.ts; the policies
-- only lock out anon/authenticated (publishable-key) access. The ledger is
-- additionally append-only (no UPDATE/DELETE for non-bypass roles), matching
-- the control_plane_secret_audit / platform_admin_audit_log precedent.

BEGIN;

-- ---------------------------------------------------------------------------
-- provider_issuing_cards — one virtual card per direct provider.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_issuing_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  stripe_cardholder_id text NOT NULL,
  stripe_card_id text NOT NULL,
  -- Display tail only. The full PAN is never persisted (scope: PANs never
  -- logged; reuse connectorSecretVault for any in-flight secret handling).
  last_four text,
  -- Hard per-card monthly ceiling, mirrored onto the Stripe card's
  -- spending_controls.spending_limits so Stripe declines at the network
  -- level even if our authorization webhook is down. USD.
  monthly_cap_usd numeric(12,2) NOT NULL CHECK (monthly_cap_usd >= 0),
  -- The provider's native auto-reload knobs (Anthropic Auto-Reload /
  -- OpenAI Auto-Recharge): top up when balance < threshold, up to ceiling.
  reload_threshold_usd numeric(12,2),
  reload_ceiling_usd numeric(12,2),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One active card per direct provider; one row per Stripe card.
  UNIQUE (provider),
  UNIQUE (stripe_card_id)
);

-- ---------------------------------------------------------------------------
-- provider_treasury_ledger — append-only wholesale-funding ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_treasury_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  card_id uuid REFERENCES provider_issuing_cards(id) ON DELETE SET NULL,
  -- funding       — share of a customer credit-pack purchase swept into the
  --                 Stripe Issuing balance (+usd)
  -- authorization — provider card charge approved in real time (-usd)
  -- capture       — authorization captured/settled (-usd, usually equal)
  -- refund        — provider refund back to the card (+usd)
  -- decline       — authorization declined (0 usd; decline_reason set)
  -- adjustment    — ops reconciliation (signed)
  type text NOT NULL CHECK (type IN (
    'funding','authorization','capture','refund','decline','adjustment'
  )),
  -- Signed, mirroring workspace_credit_ledger.credits_delta discipline:
  -- funding/refund positive, authorization/capture negative, decline zero.
  amount_usd numeric(12,4) NOT NULL,
  -- Observed Issuing balance after this movement, for point-in-time
  -- reconstruction + Stripe reconciliation. Nullable when not observed.
  issuing_balance_after_usd numeric(12,2),
  stripe_authorization_id text,
  stripe_transaction_id text,
  stripe_topup_id text,
  -- Set on type='decline': monthly_cap | insufficient_issuing_balance |
  -- unknown_card | disabled | decisioning_error.
  decline_reason text,
  -- Dedupe handle — Stripe authorization-webhook retries and purchase-sweep
  -- retries collide here and become no-ops (same as the credit ledger).
  idempotency_key text UNIQUE,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Recent activity per provider (ops dashboard, underfund checks).
CREATE INDEX IF NOT EXISTS idx_provider_treasury_ledger_provider_created
  ON provider_treasury_ledger (provider, created_at DESC);
-- Month-to-date approved-spend sums per card (authorization-webhook cap check).
-- Authorizations (holds) are the cap basis — we never also book a `capture`
-- row for the same charge, so summing authorizations can't double-count.
CREATE INDEX IF NOT EXISTS idx_provider_treasury_ledger_card_created
  ON provider_treasury_ledger (card_id, created_at DESC)
  WHERE type = 'authorization';

-- ---------------------------------------------------------------------------
-- RLS — admin-only (mirrors platform_provider_keys, migration 084). The
-- backend operates via the BYPASSRLS pool; these policies only lock out
-- anon/authenticated publishable-key access.
-- ---------------------------------------------------------------------------

-- provider_issuing_cards: mutable config, admin-only (FOR ALL).
ALTER TABLE public.provider_issuing_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_issuing_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_issuing_cards_admin_only ON public.provider_issuing_cards;
CREATE POLICY provider_issuing_cards_admin_only ON public.provider_issuing_cards
  AS PERMISSIVE FOR ALL TO public
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- provider_treasury_ledger: admin-readable + append-only (deny UPDATE/DELETE).
ALTER TABLE public.provider_treasury_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_treasury_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_treasury_ledger_admin_read ON public.provider_treasury_ledger;
CREATE POLICY provider_treasury_ledger_admin_read ON public.provider_treasury_ledger
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

DROP POLICY IF EXISTS provider_treasury_ledger_no_update ON public.provider_treasury_ledger;
CREATE POLICY provider_treasury_ledger_no_update ON public.provider_treasury_ledger
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS provider_treasury_ledger_no_delete ON public.provider_treasury_ledger;
CREATE POLICY provider_treasury_ledger_no_delete ON public.provider_treasury_ledger
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- Tables created after migration 065 don't inherit its blanket grant; grant
-- the non-superuser API role explicitly (matches migration 096). RLS still
-- gates the rows — autoflow_api is NOBYPASSRLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_issuing_cards   TO autoflow_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_treasury_ledger TO autoflow_api;

COMMIT;

-- ===========================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ===========================================================================
--
-- BEGIN;
-- DROP POLICY IF EXISTS provider_treasury_ledger_no_delete ON public.provider_treasury_ledger;
-- DROP POLICY IF EXISTS provider_treasury_ledger_no_update ON public.provider_treasury_ledger;
-- DROP POLICY IF EXISTS provider_treasury_ledger_admin_read ON public.provider_treasury_ledger;
-- DROP POLICY IF EXISTS provider_issuing_cards_admin_only ON public.provider_issuing_cards;
-- DROP TABLE IF EXISTS provider_treasury_ledger;
-- DROP TABLE IF EXISTS provider_issuing_cards;
-- COMMIT;
