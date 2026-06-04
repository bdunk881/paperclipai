-- HEL-496: generated_reports had no workspace_id, so reportStore filtered
-- reads by user_id only (src/reporting/reportStore.ts). A user who belongs to
-- multiple workspaces could list/fetch reports generated in ANY of their
-- workspaces -> cross-workspace data leakage. The existing RLS from
-- 083_rls_user_scoped.sql is user-isolation only and does NOT stop this
-- (same user_id across workspaces).
--
-- Add a nullable workspace_id, populated on insert going forward. Reads are
-- scoped at the query layer (NULL-tolerant): rows tagged with a workspace are
-- only visible under that workspace, while legacy/untagged rows remain visible
-- to their owner (no data loss, still user-scoped by RLS). 083 noted this
-- table had 0 rows.
--
-- Strict NOT NULL + a workspace-level RLS policy are intentionally deferred:
-- they require switching reportStore to withWorkspaceContext (so the
-- app.current_workspace_id GUC is set) and a backfill story, which is
-- out of scope here and tracked alongside wiring the reporting UI (HEL-488).

ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_generated_reports_workspace_created_at
  ON generated_reports (workspace_id, created_at DESC);
