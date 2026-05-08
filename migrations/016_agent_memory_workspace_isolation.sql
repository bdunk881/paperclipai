-- Migration 016: Agent memory workspace isolation + explicit cross-workspace sharing (ALT-2360)
--
-- Goals:
-- 1. Close schema drift between runtime bootstrap and committed migrations.
-- 2. Keep backend recall inside a workspace by default.
-- 3. Enforce team isolation whenever memory_layer = 'team'.
-- 4. Introduce an explicit, user-controlled cross-workspace sharing allowlist.
--
-- This migration does not enable cross-workspace reads by itself. It creates the
-- policy and grant tables future RLS / service-layer reads must consult.

BEGIN;

ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'private';
ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'generic';

ALTER TABLE agent_memory_kg_facts
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_entries_scope_check'
  ) THEN
    ALTER TABLE agent_memory_entries
      ADD CONSTRAINT agent_memory_entries_scope_check
      CHECK (scope IN ('private', 'shared'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_kg_facts_scope_check'
  ) THEN
    ALTER TABLE agent_memory_kg_facts
      ADD CONSTRAINT agent_memory_kg_facts_scope_check
      CHECK (scope IN ('private', 'shared'));
  END IF;

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

CREATE TABLE IF NOT EXISTS agent_memory_sharing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source_workspace_id text NOT NULL,
  memory_layer text NOT NULL,
  team_id text,
  cross_workspace_enabled boolean NOT NULL DEFAULT false,
  require_shared_scope boolean NOT NULL DEFAULT true,
  allow_entries boolean NOT NULL DEFAULT true,
  allow_knowledge_facts boolean NOT NULL DEFAULT true,
  allow_heartbeat_logs boolean NOT NULL DEFAULT false,
  created_by_agent_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (memory_layer IN ('agent', 'team', 'company')),
  CHECK (
    (memory_layer = 'team' AND team_id IS NOT NULL)
    OR (memory_layer IN ('agent', 'company') AND team_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_sharing_policies_unique
  ON agent_memory_sharing_policies (user_id, source_workspace_id, memory_layer, COALESCE(team_id, ''));

CREATE TABLE IF NOT EXISTS agent_memory_workspace_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES agent_memory_sharing_policies(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  source_workspace_id text NOT NULL,
  target_workspace_id text NOT NULL,
  memory_layer text NOT NULL,
  team_id text,
  share_entries boolean NOT NULL DEFAULT false,
  share_knowledge_facts boolean NOT NULL DEFAULT false,
  share_heartbeat_logs boolean NOT NULL DEFAULT false,
  created_by_agent_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (memory_layer IN ('agent', 'team', 'company')),
  CHECK (source_workspace_id <> target_workspace_id),
  CHECK (share_entries OR share_knowledge_facts OR share_heartbeat_logs),
  CHECK (
    (memory_layer = 'team' AND team_id IS NOT NULL)
    OR (memory_layer IN ('agent', 'company') AND team_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_workspace_shares_active_unique
  ON agent_memory_workspace_shares (
    user_id,
    source_workspace_id,
    target_workspace_id,
    memory_layer,
    COALESCE(team_id, '')
  )
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_memory_workspace_shares_lookup
  ON agent_memory_workspace_shares (
    user_id,
    target_workspace_id,
    source_workspace_id,
    memory_layer,
    revoked_at
  );

COMMIT;
