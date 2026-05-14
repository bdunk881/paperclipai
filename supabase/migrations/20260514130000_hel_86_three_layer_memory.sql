-- HEL-86 — Three-layer agent memory schema (Supabase mirror)
-- See migrations/034_three_layer_memory.sql for the full description.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS workspace_instructions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mission_id      UUID REFERENCES missions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'instruction'
                  CHECK (kind IN ('instruction', 'triage_policy')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  author_user_id  UUID REFERENCES users(id),
  agent_id        UUID REFERENCES agents(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workspace_instructions_workspace_idx
  ON workspace_instructions (workspace_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_instructions_agent_idx
  ON workspace_instructions (agent_id)
  WHERE agent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_instructions_mission_idx
  ON workspace_instructions (mission_id)
  WHERE mission_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  scope                TEXT NOT NULL
                       CHECK (scope IN ('autoflow_curated', 'workspace')),
  kind                 TEXT NOT NULL
                       CHECK (kind IN ('document', 'connector_pull', 'synthesized', 'verified')),
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  tags                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_type          TEXT NOT NULL,
  source_ref           TEXT,
  source_episode_ids   UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  mission_id           UUID REFERENCES missions(id) ON DELETE SET NULL,
  author_user_id       UUID REFERENCES users(id),
  author_agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  trust_score          NUMERIC NOT NULL DEFAULT 0.5,
  superseded_by        UUID REFERENCES knowledge_items(id) ON DELETE SET NULL,
  valid_until          TIMESTAMPTZ,
  embedding            vector(1536),
  embedding_version    INT NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  CONSTRAINT knowledge_items_scope_check
    CHECK ((scope = 'autoflow_curated' AND workspace_id IS NULL)
        OR (scope = 'workspace' AND workspace_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS knowledge_items_workspace_kind_idx
  ON knowledge_items (workspace_id, kind)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_items_mission_idx
  ON knowledge_items (mission_id)
  WHERE mission_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_items_curated_idx
  ON knowledge_items (kind)
  WHERE scope = 'autoflow_curated' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_items_embedding_idx
  ON knowledge_items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS agent_episodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  mission_id      UUID REFERENCES missions(id) ON DELETE SET NULL,
  run_id          UUID,
  episode_type    TEXT NOT NULL
                  CHECK (episode_type IN ('observation', 'action_result', 'reflection', 'escalation')),
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding       vector(1536),
  embedding_version INT NOT NULL DEFAULT 1,
  ttl_days        INT NOT NULL DEFAULT 90,
  expires_at      TIMESTAMPTZ GENERATED ALWAYS AS
                  (created_at + (ttl_days || ' days')::INTERVAL) STORED,
  reflected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_episodes_workspace_agent_idx
  ON agent_episodes (workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_episodes_mission_idx
  ON agent_episodes (mission_id, created_at DESC)
  WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_episodes_expires_idx
  ON agent_episodes (expires_at);
CREATE INDEX IF NOT EXISTS agent_episodes_unreflected_idx
  ON agent_episodes (workspace_id, created_at DESC)
  WHERE reflected_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_episodes_embedding_idx
  ON agent_episodes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE workspace_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_instructions_member_access ON workspace_instructions;
CREATE POLICY workspace_instructions_member_access ON workspace_instructions
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_read ON knowledge_items;
CREATE POLICY knowledge_items_member_read ON knowledge_items FOR SELECT
  USING (
    scope = 'autoflow_curated'
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_write ON knowledge_items;
CREATE POLICY knowledge_items_member_write ON knowledge_items FOR INSERT
  WITH CHECK (
    scope = 'workspace'
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

DROP POLICY IF EXISTS knowledge_items_member_update ON knowledge_items;
CREATE POLICY knowledge_items_member_update ON knowledge_items FOR UPDATE
  USING (
    scope = 'workspace'
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

DROP POLICY IF EXISTS agent_episodes_member_access ON agent_episodes;
CREATE POLICY agent_episodes_member_access ON agent_episodes
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('autoflow.user_id', true)::uuid
    )
  );

COMMIT;
