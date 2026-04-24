BEGIN;

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  creator_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'blocked', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  sla_state text NOT NULL DEFAULT 'untracked',
  due_date timestamptz,
  resolved_at timestamptz,
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_workspace_created
  ON tickets (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_workspace_status_priority
  ON tickets (workspace_id, status, priority);

CREATE TABLE IF NOT EXISTS ticket_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('agent', 'user')),
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary', 'collaborator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, actor_type, actor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_assignments_primary
  ON ticket_assignments (ticket_id)
  WHERE role = 'primary';

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_actor_lookup
  ON ticket_assignments (actor_type, actor_id, role, ticket_id);

CREATE TABLE IF NOT EXISTS ticket_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('agent', 'user')),
  actor_id text NOT NULL,
  update_type text NOT NULL CHECK (update_type IN ('comment', 'status_change', 'structured_update')),
  content text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_updates_ticket_created
  ON ticket_updates (ticket_id, created_at ASC);

COMMIT;
