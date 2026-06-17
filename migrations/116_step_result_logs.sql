-- Migration 116: per-step structured logs (HEL-706).
--
-- Adds `logs_json jsonb` to step_results — the structured log lines a step
-- emits during execution (level + message + timestamp + optional data),
-- collected by the engine's per-step StepLogger and surfaced in the run detail
-- view. Nullable; only steps that logged carry a value.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE public.step_results ADD COLUMN IF NOT EXISTS logs_json jsonb;

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed):
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.step_results DROP COLUMN IF EXISTS logs_json;
-- COMMIT;
