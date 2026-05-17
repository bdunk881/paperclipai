-- HEL-107: Add idempotency_key to step_results for safe replay.
--
-- Nullable so existing rows are unaffected. A partial unique index enforces
-- uniqueness only for non-null values, which prevents duplicate step writes
-- on BullMQ retries without breaking historical data.

ALTER TABLE public.step_results
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_results_idempotency_key
  ON public.step_results (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
