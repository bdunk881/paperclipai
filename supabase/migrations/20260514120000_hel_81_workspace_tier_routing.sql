-- HEL-81 — Workspace tier routing matrix (Supabase mirror of migrations/033)
--
-- Adds `tier_routing` JSONB to workspaces + `tier_overrides` JSONB to agents.
-- See migrations/033_workspace_tier_routing.sql for the full description.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS tier_routing JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN workspaces.tier_routing IS
  'Tier-to-provider/model map. Keys: small, medium, large, embeddings, vision.';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tier_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agents.tier_overrides IS
  'Per-agent tier binding override. Same shape as workspaces.tier_routing.';

CREATE INDEX IF NOT EXISTS workspaces_tier_routing_gin_idx
  ON workspaces USING gin (tier_routing);

CREATE INDEX IF NOT EXISTS agents_tier_overrides_gin_idx
  ON agents USING gin (tier_overrides);

COMMIT;
