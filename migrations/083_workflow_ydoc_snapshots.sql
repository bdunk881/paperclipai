-- HEL-286 — Y.Doc snapshot persistence for the y-websocket server.
--
-- One snapshot row per workflow. The server holds the live Y.Doc in
-- process memory; this table is the durable mirror so a restart or a
-- last-client-disconnect can rehydrate. The state column is the binary
-- output of Y.encodeStateAsUpdate() — encoded full state, not deltas.
--
-- workspace_id is denormalized from workflows(id) so the RLS policy is a
-- single-table check matching the canonical pattern used by every other
-- workspace-scoped table (HEL-19 / migration 023). The FK to workflows
-- keeps it in sync via ON DELETE CASCADE.

CREATE TABLE IF NOT EXISTS workflow_ydoc_snapshots (
  workflow_id  uuid PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  state        bytea NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_ydoc_snapshots_workspace_idx
  ON workflow_ydoc_snapshots(workspace_id);

ALTER TABLE workflow_ydoc_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_ydoc_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_ydoc_snapshots_tenant_isolation ON workflow_ydoc_snapshots;
CREATE POLICY workflow_ydoc_snapshots_tenant_isolation
ON workflow_ydoc_snapshots
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);
