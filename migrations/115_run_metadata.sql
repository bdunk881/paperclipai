-- Migration 115: mutable run metadata (HEL-705).
--
-- Adds a free-form `metadata jsonb` to runs — structured data attached at
-- trigger time and mutated from inside a run (set / append / increment / del),
-- surfaced for live progress (trigger.dev-style run metadata). A ≤256KB cap is
-- enforced in the application layer (runMetadata.ts), not the DB.
--
-- No index: metadata is attached/read per-run, not filtered across runs (tag
-- filtering is HEL-704). Existing rows backfill to '{}' via the DEFAULT.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed):
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.runs DROP COLUMN IF EXISTS metadata;
-- COMMIT;
