BEGIN;

CREATE TABLE IF NOT EXISTS llm_configs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'mistral')),
  label text NOT NULL,
  model text NOT NULL,
  api_key_encrypted text NOT NULL,
  api_key_masked text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_configs_user_id
  ON llm_configs (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_configs_user_default
  ON llm_configs (user_id)
  WHERE is_default = true;

COMMIT;
