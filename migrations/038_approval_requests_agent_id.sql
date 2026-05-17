-- Migration 038: approval_requests.agent_id (DASH-14 / HEL-133)
--
-- UX-10 first wired the dashboard's per-approval presence pill by
-- joining `approval_requests.assignee` (a human-typed name string)
-- against the workspace's agent list — a brittle client-side
-- lower-cased name match that breaks the moment an owner renames
-- an agent.
--
-- This migration adds a real FK so the dashboard can look up the
-- owning agent by id. Nullable because legacy rows predate the
-- column and the WorkflowEngine doesn't always carry agent context
-- through to approval creation yet; the dashboard falls back to
-- the old name match when agent_id IS NULL.

BEGIN;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_agent_id
  ON approval_requests (agent_id)
  WHERE agent_id IS NOT NULL;

COMMIT;
