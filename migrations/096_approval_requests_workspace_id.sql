-- HEL-400: scope approvals by workspace.
--
-- `approval_requests` had no workspace_id, so the home snapshot's
-- loadApprovals() filtered only by assignee — a user who belongs to multiple
-- workspaces saw their approvals across all of them (cross-workspace bleed in
-- the per-workspace home view). The FK target workflow_runs has no workspace_id
-- either, so a join can't recover it; stamp the workspace on the row instead.
--
-- New approvals are stamped with workspace_id at create time. Legacy rows stay
-- NULL; the read-side filter treats NULL as "visible to its assignee in any
-- workspace" so in-flight approvals are not hidden mid-deploy. Approvals are
-- short-lived (they resolve or time out), so the residual NULL rows drain
-- quickly and the bleed self-heals.

ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS workspace_id text;

CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace_assignee
  ON approval_requests (workspace_id, assignee);
