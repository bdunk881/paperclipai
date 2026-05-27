-- HEL-credits-mvp — fix Codex P1 in commit_credits balance math.
--
-- Original (migration 068) computed:
--   balance_credits = balance_credits - GREATEST(v_diff, -balance_credits)
--
-- Two bugs in that formula:
--
-- 1) **Over-spend explodes the wallet.** When the LLM uses more tokens
--    than reserved AND the surplus exceeds the spare balance,
--    `v_diff > balance_credits`. GREATEST(v_diff, -balance_credits)
--    returns v_diff, and `balance - v_diff` goes negative — violating
--    the `CHECK (balance_credits >= 0)` constraint on the wallet table.
--    The commit fails after a successful LLM call, the reservation
--    stays unresolved, and the caller surfaces a wallet_error to the
--    customer (who actually got their model output).
--
-- 2) **Under-spend on a drained wallet refunds zero.** When v_diff is
--    negative (under-spend) and balance is currently zero (because a
--    larger reservation drained it), GREATEST(v_diff, 0) returns 0, so
--    no refund happens. The customer's unused reserved credits get
--    silently kept.
--
-- The fix: clamp the debit, not the refund. Use LEAST instead of
-- GREATEST. Trace:
--
--   v_diff > 0 over-spend:
--     LEAST(v_diff, balance_credits) = at most balance_credits
--     → balance - (at most balance_credits) ≥ 0 ✓
--
--   v_diff ≤ 0 under-spend:
--     LEAST(neg, balance) = neg (since balance ≥ 0)
--     → balance - neg = balance + abs(v_diff) ✓
--
-- The `lifetime_consumed_credits` formula was correct already
-- (capped at v_reserved_credits + balance_credits = "what could possibly
-- have been charged"), so it stays as-is.
--
-- CREATE OR REPLACE so re-application is idempotent. Migration 068 stays
-- as the historical artifact; every DB that's seen 068 will get 075
-- applied on top.

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
    RETURN QUERY SELECT false, NULL::bigint, 'no_reservation'::text;
    RETURN;
  END IF;

  v_reserved_credits := -v_reservation.credits_delta;
  v_diff := p_actual_credits - v_reserved_credits;

  -- CODEX P1 FIX (was GREATEST(v_diff, -balance_credits), which let
  -- balance go negative on over-spend and silently dropped under-spend
  -- refunds when the wallet was already drained).
  UPDATE workspace_credit_wallets
  SET balance_credits = balance_credits - LEAST(v_diff, balance_credits),
      lifetime_consumed_credits = lifetime_consumed_credits +
        LEAST(p_actual_credits, v_reserved_credits + balance_credits),
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
