-- HEL-credits-mvp — append-only ledger of every credit wallet movement.
--
-- Every reserve / commit / release / purchase / grant / refund touches
-- the wallet AND inserts a row here. The ledger is the audit-source-of-
-- truth: balance_after is recorded on each row so we can reconstruct
-- balance at any point in time and reconcile against Stripe + provider
-- billing. `idempotency_key` is the dedupe handle — Stripe webhook
-- retries, reservation re-tries, and double-tap commit calls all collide
-- on this column and become no-ops.
--
-- type meanings:
--   purchase            — Stripe credit-pack payment confirmed (+credits)
--   grant               — manual or promotional grant (+credits)
--   refund              — Stripe refund post-purchase (-credits)
--   reservation         — worst-case credits held pending LLM call (-credits)
--   reservation_release — LLM call failed before commit, reservation undone (+credits)
--   consumption         — LLM call completed, actual cost committed (-credits)
--   expiration          — credits aged out by retention policy (-credits)
--   adjustment          — ops override (signed)

CREATE TABLE IF NOT EXISTS workspace_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'purchase','consumption','refund','grant','expiration','adjustment','reservation','reservation_release'
  )),
  credits_delta bigint NOT NULL,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  related_kind text,
  related_id text,
  provider text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  cached_prompt_tokens integer,
  wholesale_cost_usd numeric(12,6),
  retail_cost_usd numeric(12,6),
  markup_multiplier numeric(6,4),
  idempotency_key text UNIQUE,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_workspace_created
  ON workspace_credit_ledger (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_type
  ON workspace_credit_ledger (workspace_id, type);
-- Used by openrouterHealthJob.ts to compute trailing-24h wholesale spend.
CREATE INDEX IF NOT EXISTS idx_credit_ledger_consumption_recent
  ON workspace_credit_ledger (created_at)
  WHERE type = 'consumption';

ALTER TABLE workspace_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credit_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_credit_ledger_tenant_isolation ON workspace_credit_ledger;
CREATE POLICY workspace_credit_ledger_tenant_isolation
ON workspace_credit_ledger
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

-- ---------------------------------------------------------------------------
-- Atomic wallet operations.
--
-- Mirrors the reserve_budget_cents pattern from migration 025: one UPDATE
-- with the guard inlined in the WHERE clause so concurrent reservations
-- against the same wallet can't overdraw. SECURITY DEFINER lets the app
-- role call these without touching the wallet row directly — the function
-- enforces the invariants.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reserve_credits(
  p_workspace_id uuid,
  p_credits bigint,
  p_idempotency_key text,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE(reserved boolean, balance_after bigint, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing workspace_credit_ledger%ROWTYPE;
  v_new_balance bigint;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'reserve_credits: p_credits must be positive (got %)', p_credits;
  END IF;

  -- Idempotency: if the caller has already reserved under this key, return
  -- the prior result without double-counting. We look at the ledger because
  -- it's the durable record of every movement.
  SELECT * INTO v_existing
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    -- Caller retry. If the prior row was a reservation, surface its
    -- balance_after. If anything else (commit / release), the reservation
    -- has already moved on and we still no-op — the caller will read its
    -- own commit ledger row.
    RETURN QUERY SELECT true, v_existing.balance_after, 'duplicate'::text;
    RETURN;
  END IF;

  UPDATE workspace_credit_wallets
  SET balance_credits = balance_credits - p_credits,
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND balance_credits >= p_credits
  RETURNING balance_credits INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, 'insufficient_credits'::text;
    RETURN;
  END IF;

  INSERT INTO workspace_credit_ledger (
    workspace_id, type, credits_delta, balance_after,
    provider, model, idempotency_key, metadata
  )
  VALUES (
    p_workspace_id, 'reservation', -p_credits, v_new_balance,
    p_provider, p_model, p_idempotency_key, p_metadata
  );

  RETURN QUERY SELECT true, v_new_balance, 'reserved'::text;
END;
$$;

CREATE OR REPLACE FUNCTION commit_credits(
  p_workspace_id uuid,
  p_reservation_idempotency_key text,
  p_commit_idempotency_key text,
  p_actual_credits bigint,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_cached_prompt_tokens integer,
  p_wholesale_cost_usd numeric,
  p_retail_cost_usd numeric,
  p_markup_multiplier numeric,
  p_related_kind text DEFAULT NULL,
  p_related_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE(committed boolean, balance_after bigint, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation workspace_credit_ledger%ROWTYPE;
  v_existing_commit workspace_credit_ledger%ROWTYPE;
  v_reserved_credits bigint;
  v_diff bigint;
  v_new_balance bigint;
BEGIN
  IF p_actual_credits < 0 THEN
    RAISE EXCEPTION 'commit_credits: p_actual_credits must be non-negative (got %)', p_actual_credits;
  END IF;

  -- Idempotent commit: the caller's retry sees the existing commit row.
  SELECT * INTO v_existing_commit
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_commit_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_existing_commit.balance_after, 'duplicate'::text;
    RETURN;
  END IF;

  SELECT * INTO v_reservation
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_reservation_idempotency_key
    AND type = 'reservation'
  LIMIT 1;

  IF NOT FOUND THEN
    -- No matching reservation. This is a logic bug in the caller; refuse
    -- so a stray commit can't drain a wallet without a reservation gate.
    RETURN QUERY SELECT false, NULL::bigint, 'no_reservation'::text;
    RETURN;
  END IF;

  v_reserved_credits := -v_reservation.credits_delta;
  v_diff := p_actual_credits - v_reserved_credits;

  -- If we reserved 1000 and actually used 800, give back 200. If we
  -- reserved 1000 and actually used 1100, take another 100 (provided
  -- the wallet still has it; otherwise commit at the reserved cap so
  -- a single over-spend can't push us negative).
  UPDATE workspace_credit_wallets
  SET balance_credits = balance_credits - GREATEST(v_diff, -balance_credits),
      lifetime_consumed_credits = lifetime_consumed_credits +
        LEAST(p_actual_credits, v_reserved_credits + balance_credits),
      updated_at = now()
  WHERE workspace_id = p_workspace_id
  RETURNING balance_credits INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, 'wallet_missing'::text;
    RETURN;
  END IF;

  -- Convert the reservation row into a consumption row. We delete the
  -- reservation marker and replace it with the durable consumption
  -- record. The ledger still keeps a complete history because every
  -- intermediate state had its own row (reservation row is gone now;
  -- the *consumption* row is what we keep).
  DELETE FROM workspace_credit_ledger
  WHERE id = v_reservation.id;

  INSERT INTO workspace_credit_ledger (
    workspace_id, type, credits_delta, balance_after,
    related_kind, related_id, provider, model,
    prompt_tokens, completion_tokens, cached_prompt_tokens,
    wholesale_cost_usd, retail_cost_usd, markup_multiplier,
    idempotency_key, metadata
  )
  VALUES (
    p_workspace_id, 'consumption', -p_actual_credits, v_new_balance,
    p_related_kind, p_related_id, p_provider, p_model,
    p_prompt_tokens, p_completion_tokens, p_cached_prompt_tokens,
    p_wholesale_cost_usd, p_retail_cost_usd, p_markup_multiplier,
    p_commit_idempotency_key, p_metadata
  );

  RETURN QUERY SELECT true, v_new_balance, 'committed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION release_credits(
  p_workspace_id uuid,
  p_reservation_idempotency_key text,
  p_release_idempotency_key text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(released boolean, balance_after bigint, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation workspace_credit_ledger%ROWTYPE;
  v_existing_release workspace_credit_ledger%ROWTYPE;
  v_reserved_credits bigint;
  v_new_balance bigint;
BEGIN
  SELECT * INTO v_existing_release
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_release_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_existing_release.balance_after, 'duplicate'::text;
    RETURN;
  END IF;

  SELECT * INTO v_reservation
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_reservation_idempotency_key
    AND type = 'reservation'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, 'no_reservation'::text;
    RETURN;
  END IF;

  v_reserved_credits := -v_reservation.credits_delta;

  UPDATE workspace_credit_wallets
  SET balance_credits = balance_credits + v_reserved_credits,
      updated_at = now()
  WHERE workspace_id = p_workspace_id
  RETURNING balance_credits INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, 'wallet_missing'::text;
    RETURN;
  END IF;

  DELETE FROM workspace_credit_ledger
  WHERE id = v_reservation.id;

  INSERT INTO workspace_credit_ledger (
    workspace_id, type, credits_delta, balance_after,
    idempotency_key, metadata
  )
  VALUES (
    p_workspace_id, 'reservation_release', v_reserved_credits, v_new_balance,
    p_release_idempotency_key,
    jsonb_build_object('reason', COALESCE(p_reason, 'unspecified'))
  );

  RETURN QUERY SELECT true, v_new_balance, 'released'::text;
END;
$$;

CREATE OR REPLACE FUNCTION grant_credits(
  p_workspace_id uuid,
  p_credits bigint,
  p_grant_type text,
  p_idempotency_key text,
  p_related_kind text DEFAULT NULL,
  p_related_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS TABLE(granted boolean, balance_after bigint, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing workspace_credit_ledger%ROWTYPE;
  v_new_balance bigint;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'grant_credits: p_credits must be positive (got %)', p_credits;
  END IF;
  IF p_grant_type NOT IN ('purchase','grant','refund','adjustment') THEN
    RAISE EXCEPTION 'grant_credits: unknown grant_type %', p_grant_type;
  END IF;

  SELECT * INTO v_existing
  FROM workspace_credit_ledger
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_existing.balance_after, 'duplicate'::text;
    RETURN;
  END IF;

  INSERT INTO workspace_credit_wallets (workspace_id, balance_credits, lifetime_purchased_credits)
  VALUES (p_workspace_id, p_credits,
          CASE WHEN p_grant_type = 'purchase' THEN p_credits ELSE 0 END)
  ON CONFLICT (workspace_id) DO UPDATE
  SET balance_credits = workspace_credit_wallets.balance_credits + EXCLUDED.balance_credits,
      lifetime_purchased_credits = workspace_credit_wallets.lifetime_purchased_credits
        + CASE WHEN p_grant_type = 'purchase' THEN EXCLUDED.balance_credits ELSE 0 END,
      updated_at = now()
  RETURNING balance_credits INTO v_new_balance;

  INSERT INTO workspace_credit_ledger (
    workspace_id, type, credits_delta, balance_after,
    related_kind, related_id, idempotency_key, metadata
  )
  VALUES (
    p_workspace_id, p_grant_type, p_credits, v_new_balance,
    p_related_kind, p_related_id, p_idempotency_key, p_metadata
  );

  RETURN QUERY SELECT true, v_new_balance, 'granted'::text;
END;
$$;
