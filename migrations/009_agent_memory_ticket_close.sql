BEGIN;

ALTER TABLE agent_memory_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'generic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_memory_entries_entry_type_check'
  ) THEN
    ALTER TABLE agent_memory_entries
      ADD CONSTRAINT agent_memory_entries_entry_type_check
      CHECK (entry_type IN ('generic', 'ticket_close'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_user_agent_type
  ON agent_memory_entries (user_id, agent_id, entry_type, updated_at DESC);

COMMIT;
