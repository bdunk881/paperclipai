-- Migration 032: missions.metadata jsonb for HEL-23 structured prompts.
--
-- The HEL-23 mission intake UI captures both a free-text mission statement
-- (already covered by `missions.statement`) and four optional structured
-- prompts that help the plan generator anchor on real numbers instead of
-- guessing:
--
--   - industry         (e.g. "industrial robotics", "B2B SaaS")
--   - targetCustomer   (e.g. "OEM purchasing managers in the US")
--   - successMetric    (e.g. "200 demos by Q4")
--   - runway           (e.g. "$250k over 6 months")
--
-- These are stored as a single JSONB column so we can add more fields later
-- without another migration. Empty defaults are safe — the HEL-24
-- plan-generator already treats them as `null` / `[]` when missing.

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Optional GIN index for future "search missions by industry" queries.
-- Cheap to add now, expensive to add later under load.
CREATE INDEX IF NOT EXISTS missions_metadata_gin_idx
  ON missions USING gin (metadata);
