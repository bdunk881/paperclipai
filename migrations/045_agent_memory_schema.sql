-- DASH-63: extract the agent_memory schema from src/agents/agentMemoryStore.ts
-- into a proper migration.
--
-- Pre-DASH-63 agentMemoryStore.ts:500-742 ran 45+ CREATE TABLE / ALTER TABLE
-- statements at first request via an `ensureSchema()` helper. That worked
-- because each statement was idempotent (IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, etc.) but it meant:
--   - schema lived in code rather than under git-tracked migrations
--   - the runtime runner (src/db/sqlMigrations.ts) had no record of these
--     tables, so the over-seed repair logic couldn't audit them
--   - DASH-52's drop of agent_memory_sharing_policies + agent_memory_workspace_shares
--     would have been silently re-undone on the next boot by ensureSchema
--
-- This migration replaces the runtime DDL. The two dead-table sections
-- (sharing_policies + workspace_shares) from the original block are NOT
-- recreated — they were dropped in DASH-52 because nothing reads from them.
-- The ensureSchema function itself is left as a no-op stub in the store
-- (to preserve callsite signatures) and will be removed in a follow-up.

CREATE TABLE IF NOT EXISTS agent_memory_entries (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
  entry_type text NOT NULL DEFAULT 'generic' CHECK (entry_type IN ('generic', 'ticket_close')),
  memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
  team_id text,
  key text NOT NULL,
  text_value text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_memory_kg_facts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
  memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
  team_id text,
  subject text NOT NULL,
  predicate text NOT NULL,
  object text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_heartbeat_logs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text NOT NULL,
  memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
  team_id text,
  status text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_memory_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  memory_layer text NOT NULL CHECK (memory_layer IN ('agent', 'team', 'company')),
  team_id text,
  entity_type text NOT NULL CHECK (entity_type IN ('entry', 'knowledge_fact', 'heartbeat_log')),
  event_type text NOT NULL CHECK (event_type IN ('created', 'archived')),
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

-- Team-layer guard constraints (originally added by the DO $$ block in
-- ensureSchema). Single-statement form because DO blocks complicate the
-- boot-runner's statement-by-statement execution.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_entries_team_layer_check'
  ) THEN
    ALTER TABLE agent_memory_entries
      ADD CONSTRAINT agent_memory_entries_team_layer_check
      CHECK (
        (memory_layer = 'team' AND team_id IS NOT NULL)
        OR (memory_layer IN ('agent', 'company'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_kg_facts_team_layer_check'
  ) THEN
    ALTER TABLE agent_memory_kg_facts
      ADD CONSTRAINT agent_memory_kg_facts_team_layer_check
      CHECK (
        (memory_layer = 'team' AND team_id IS NOT NULL)
        OR (memory_layer IN ('agent', 'company'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_heartbeat_logs_team_layer_check'
  ) THEN
    ALTER TABLE agent_heartbeat_logs
      ADD CONSTRAINT agent_heartbeat_logs_team_layer_check
      CHECK (
        (memory_layer = 'team' AND team_id IS NOT NULL)
        OR (memory_layer IN ('agent', 'company'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_events_team_layer_check'
  ) THEN
    ALTER TABLE agent_memory_events
      ADD CONSTRAINT agent_memory_events_team_layer_check
      CHECK (
        (memory_layer = 'team' AND team_id IS NOT NULL)
        OR (memory_layer IN ('agent', 'company'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_workspace_layer
  ON agent_memory_entries (user_id, workspace_id, memory_layer, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_kg_facts_workspace_layer
  ON agent_memory_kg_facts (user_id, workspace_id, memory_layer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_logs_workspace_layer
  ON agent_heartbeat_logs (user_id, workspace_id, memory_layer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_events_workspace_created
  ON agent_memory_events (user_id, workspace_id, created_at DESC);
