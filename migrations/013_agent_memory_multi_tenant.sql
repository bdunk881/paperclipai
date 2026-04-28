BEGIN;

ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS workspace_id text;
UPDATE agent_memory_entries
  SET workspace_id = user_id
  WHERE workspace_id IS NULL;
ALTER TABLE agent_memory_entries
  ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent';
ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS team_id text;
ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE agent_memory_kg_facts
  ADD COLUMN IF NOT EXISTS workspace_id text;
UPDATE agent_memory_kg_facts
  SET workspace_id = user_id
  WHERE workspace_id IS NULL;
ALTER TABLE agent_memory_kg_facts
  ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE agent_memory_kg_facts
  ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent';
ALTER TABLE agent_memory_kg_facts
  ADD COLUMN IF NOT EXISTS team_id text;
ALTER TABLE agent_memory_kg_facts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE agent_heartbeat_logs
  ADD COLUMN IF NOT EXISTS workspace_id text;
UPDATE agent_heartbeat_logs
  SET workspace_id = user_id
  WHERE workspace_id IS NULL;
ALTER TABLE agent_heartbeat_logs
  ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE agent_heartbeat_logs
  ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent';
ALTER TABLE agent_heartbeat_logs
  ADD COLUMN IF NOT EXISTS team_id text;
ALTER TABLE agent_heartbeat_logs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS agent_memory_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  memory_layer text NOT NULL DEFAULT 'agent',
  team_id text,
  entity_type text NOT NULL,
  event_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_entries_memory_layer_check'
  ) THEN
    ALTER TABLE agent_memory_entries
      ADD CONSTRAINT agent_memory_entries_memory_layer_check
      CHECK (memory_layer IN ('agent', 'team', 'company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_kg_facts_memory_layer_check'
  ) THEN
    ALTER TABLE agent_memory_kg_facts
      ADD CONSTRAINT agent_memory_kg_facts_memory_layer_check
      CHECK (memory_layer IN ('agent', 'team', 'company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_heartbeat_logs_memory_layer_check'
  ) THEN
    ALTER TABLE agent_heartbeat_logs
      ADD CONSTRAINT agent_heartbeat_logs_memory_layer_check
      CHECK (memory_layer IN ('agent', 'team', 'company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_events_memory_layer_check'
  ) THEN
    ALTER TABLE agent_memory_events
      ADD CONSTRAINT agent_memory_events_memory_layer_check
      CHECK (memory_layer IN ('agent', 'team', 'company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_events_entity_type_check'
  ) THEN
    ALTER TABLE agent_memory_events
      ADD CONSTRAINT agent_memory_events_entity_type_check
      CHECK (entity_type IN ('entry', 'knowledge_fact', 'heartbeat_log'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_events_event_type_check'
  ) THEN
    ALTER TABLE agent_memory_events
      ADD CONSTRAINT agent_memory_events_event_type_check
      CHECK (event_type IN ('created', 'archived'));
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

COMMIT;
