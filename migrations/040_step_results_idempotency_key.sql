-- HEL-107 (DASH-36): add idempotency_key to step_results for safe BullMQ replay.
--
-- Originally this migration was authored only under supabase/migrations/ —
-- which the boot-time runner in src/db/sqlMigrations.ts does NOT scan — so
-- prod's step_results table never gained the column even though runStore.ts
-- began SELECT/INSERTing it. The result was ~25k Sentry log errors per week
-- ("column \"idempotency_key\" does not exist") on every runs list. DASH-36
-- republished it here; DASH-39 consolidated migrations into this directory
-- only, so this footgun can't recur.
--
-- Nullable so existing rows are unaffected. A partial unique index enforces
-- uniqueness only for non-null values, preventing duplicate step writes on
-- BullMQ retries without breaking historical data.

ALTER TABLE public.step_results
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_results_idempotency_key
  ON public.step_results (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
