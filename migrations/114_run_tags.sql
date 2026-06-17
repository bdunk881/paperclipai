-- Migration 114: run tags (HEL-704).
--
-- Adds a free-form `tags text[]` to runs so a run can be labeled at trigger
-- time (and from inside a run) for multi-tenant / per-entity grouping, with a
-- tag-containment filter on the runs list (trigger.dev-style run tags).
--
-- A GIN index backs `tags @> ARRAY[...]` containment queries used by
-- runStore.list's tag filter. Existing rows backfill to '{}' via the DEFAULT.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS runs_tags_gin_idx ON public.runs USING gin (tags);

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed):
-- ============================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS runs_tags_gin_idx;
-- ALTER TABLE public.runs DROP COLUMN IF EXISTS tags;
-- COMMIT;
