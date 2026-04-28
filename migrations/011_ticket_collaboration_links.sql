BEGIN;

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_parent_id_created
  ON tickets (parent_id, created_at DESC);

COMMIT;
