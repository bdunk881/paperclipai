BEGIN;

CREATE TABLE IF NOT EXISTS agent_memory_entries (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
  key text NOT NULL,
  text_value text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_user_agent
  ON agent_memory_entries (user_id, agent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_user_scope
  ON agent_memory_entries (user_id, scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_expires_at
  ON agent_memory_entries (expires_at);

CREATE TABLE IF NOT EXISTS agent_memory_kg_facts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
  subject text NOT NULL,
  predicate text NOT NULL,
  object text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_kg_facts_user_agent
  ON agent_memory_kg_facts (user_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_kg_facts_user_scope
  ON agent_memory_kg_facts (user_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_kg_facts_expires_at
  ON agent_memory_kg_facts (expires_at);

CREATE TABLE IF NOT EXISTS agent_heartbeat_logs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text NOT NULL,
  status text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_logs_user_agent
  ON agent_heartbeat_logs (user_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_logs_run_id
  ON agent_heartbeat_logs (run_id);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_logs_expires_at
  ON agent_heartbeat_logs (expires_at);

COMMIT;
