-- HEL-107 (DASH-36): add idempotency_key to step_results for safe BullMQ replay.
--
-- This migration is a duplicate of
-- supabase/migrations/20260517090000_hel_107_step_results_idempotency_key.sql,
-- intentionally added under the numeric `migrations/` directory because that is
-- the only directory the boot-time runner in src/db/sqlMigrations.ts scans.
-- Without it, prod's step_results table never gained the column even though
-- runStore.ts began SELECT/INSERTing it — generating ~25k Sentry log errors
-- per week ("column \"idempotency_key\" does not exist") on every runs list.
--
-- Nullable so existing rows are unaffected. A partial unique index enforces
-- uniqueness only for non-null values, preventing duplicate step writes on
-- BullMQ retries without breaking historical data.

ALTER TABLE public.step_results
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_results_idempotency_key
  ON public.step_results (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
