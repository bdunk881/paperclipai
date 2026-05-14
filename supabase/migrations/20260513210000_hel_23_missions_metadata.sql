-- HEL-23: missions.metadata jsonb for structured prompts captured by the
-- Hire page mission intake form. See `migrations/032_missions_metadata.sql`
-- for the mirror file used by the Node-side migrator + rationale.

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS missions_metadata_gin_idx
  ON missions USING gin (metadata);
