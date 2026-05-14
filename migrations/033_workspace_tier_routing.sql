-- HEL-81 — Workspace tier routing matrix
--
-- Adds `tier_routing` JSONB column to workspaces so customers (BYOK or hosted)
-- can map AutoFlow's logical tiers ("small", "medium", "large", "embeddings",
-- "vision") to concrete provider/model pairs. This is the abstraction layer
-- that lets the rest of the platform reference tiers without hardcoding
-- specific providers.
--
-- Shape of `tier_routing`:
-- {
--   "small":      { "provider": "openai",    "model": "gpt-4.1-nano",      "credential_id": "<uuid>" },
--   "medium":     { "provider": "anthropic", "model": "claude-sonnet-4.5", "credential_id": "<uuid>" },
--   "large":      { "provider": "anthropic", "model": "claude-opus-4.7",   "credential_id": "<uuid>" },
--   "embeddings": { "provider": "openai",    "model": "text-embedding-3-small", "version": 1 },
--   "vision":     { "provider": "anthropic", "model": "claude-sonnet-4.5", "credential_id": "<uuid>" }
-- }
--
-- Null/empty matrix means "fall back to AutoFlow defaults inferred from
-- whichever BYOK provider(s) the workspace has connected" — see
-- src/llmConfig/tierRouter.ts:getDefaultTierMatrix().
--
-- Adds a sibling `tier_overrides` JSONB column to `agents` so a specific
-- agent can pin a non-workspace-default tier binding (e.g., "Atlas uses
-- GPT-5 for reasoning even though the workspace default is Claude").

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS tier_routing JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN workspaces.tier_routing IS
  'Tier-to-provider/model map. Keys: small, medium, large, embeddings, vision. ' ||
  'Empty object falls back to inferred defaults based on connected BYOK credentials. ' ||
  'See src/llmConfig/tierRouter.ts.';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tier_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agents.tier_overrides IS
  'Per-agent tier binding override. Same shape as workspaces.tier_routing. ' ||
  'When set for a tier, this overrides the workspace default for that agent only.';

-- GIN indexes for jsonb path lookups (cheap; only used when explicitly
-- querying by inner key — most reads go through tierRouter.resolveTier).
CREATE INDEX IF NOT EXISTS workspaces_tier_routing_gin_idx
  ON workspaces USING gin (tier_routing);

CREATE INDEX IF NOT EXISTS agents_tier_overrides_gin_idx
  ON agents USING gin (tier_overrides);

COMMIT;
