-- Migration 024: Canonical approvals, tickets audit, activity_events (HEL-16)
--
-- Per HEL-16 description: "audit existing approval_* and ticket_*". Outcome:
--
--  * `approvals`        — NEW canonical HITL gate. Coexists with the legacy
--                         `approval_requests` table (002) which is keyed on
--                         workflow_runs.id and lacks the canonical tier field.
--                         Code paths migrate to `approvals` in a follow-up.
--  * `tickets`          — already canonical (008_ticketing.sql). No-op here.
--  * `activity_events`  — NEW append-only event stream for the workspace.

BEGIN;

-- ============================================================
-- approvals (canonical HITL gate)
-- ============================================================
-- Coexists with `approval_requests` from 002_workflow_runtime_persistence.sql.
-- The legacy table is keyed on `workflow_runs(id)`; the canonical version is
-- keyed on the canonical `runs(id)` from HEL-15 and carries a tier from the
-- approval_tier_policies action_type vocabulary.
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
  step_id text,
  tier text NOT NULL
    CHECK (tier IN (
      'spend_above_threshold',
      'contracts',
      'public_posts',
      'customer_facing_comms',
      'code_merges_to_prod'
    )),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'timed_out')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id text REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  decided_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- decided_at and decided_by_user_id pair coherently when a decision lands.
  CONSTRAINT approvals_decision_pair
    CHECK (
      (status IN ('pending', 'timed_out')
        AND decided_at IS NULL
        AND decided_by_user_id IS NULL)
      OR (status IN ('approved', 'rejected')
        AND decided_at IS NOT NULL
        AND decided_by_user_id IS NOT NULL)
    )
);

-- ============================================================
-- activity_events (append-only workspace event stream)
-- ============================================================
-- Drives "the room right now" Activity feed (HEL-29). Append-only:
-- producers INSERT, the only UPDATE/DELETE path is admin-initiated
-- compliance scrub (out of scope here; future GDPR ticket).
--
-- `kind` is intentionally text rather than an enum so the producer set
-- can grow without needing migrations. Standard kinds in flight:
--   run.started, run.succeeded, run.failed, run.cancelled
--   approval.requested, approval.approved, approval.rejected
--   agent.message, agent.provisioned, agent.paused
--   ticket.created, ticket.assigned, ticket.resolved
--   hiring_plan.generated, hiring_plan.accepted
--   connector.connected, connector.disconnected, connector.failed
CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- Polymorphic actor — could be a user, an agent, or 'system'.
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  actor_id text,
  -- Subject of the event (which run / approval / ticket / agent it concerns).
  -- Polymorphic — `subject_kind` plus `subject_id` so consumers can join.
  subject_kind text,
  subject_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_approvals_workspace_id
  ON approvals (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_run_id
  ON approvals (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_decided_by_user_id
  ON approvals (decided_by_user_id)
  WHERE decided_by_user_id IS NOT NULL;

-- Activity feed reads are dominated by "give me the workspace's recent events".
-- The covering index supports that as a single seek + range scan.
CREATE INDEX IF NOT EXISTS idx_activity_events_workspace_recent
  ON activity_events (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_kind
  ON activity_events (workspace_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_subject
  ON activity_events (subject_kind, subject_id)
  WHERE subject_kind IS NOT NULL;

-- ============================================================
-- RLS — workspace isolation
-- ============================================================
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_tenant_isolation ON approvals;
CREATE POLICY approvals_tenant_isolation
ON approvals
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

DROP POLICY IF EXISTS activity_events_tenant_isolation ON activity_events;
CREATE POLICY activity_events_tenant_isolation
ON activity_events
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

COMMIT;
