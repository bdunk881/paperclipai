-- HEL-212 — budget_ceilings (PR H: Budget rework).
--
-- The existing `budgets` table (migration 025) is the workspace + per-agent
-- spend rollup with usage counters. It's append-only on the spend side and
-- doesn't carry user-configurable alert thresholds.
--
-- This table is the user-facing **ceiling** configuration: "I want this
-- mission / team / agent capped at $X with a warning at Y%." Scope kinds
-- expand to mission/team/agent (the by-scope filters on the Budget v2
-- dashboard) plus the existing workspace tier. Stored separately so the
-- usage-tracker writes in `budgets` stay simple and ceilings can be
-- versioned/edited without racing the usage column.
--
-- Endpoints: `PUT /api/budget` (src/budget/budgetSetRoute.ts).

CREATE TABLE IF NOT EXISTS budget_ceilings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('workspace', 'mission', 'team', 'agent')),
  scope_id uuid,
  ceiling_usd numeric(12,2) NOT NULL CHECK (ceiling_usd >= 0),
  alert_threshold_pct integer NOT NULL DEFAULT 80
    CHECK (alert_threshold_pct >= 0 AND alert_threshold_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_kind = 'workspace' AND scope_id IS NULL)
    OR (scope_kind <> 'workspace' AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_ceilings_workspace_scope
  ON budget_ceilings (
    workspace_id,
    scope_kind,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_budget_ceilings_workspace
  ON budget_ceilings (workspace_id);

ALTER TABLE budget_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_ceilings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_ceilings_tenant_isolation ON budget_ceilings;
CREATE POLICY budget_ceilings_tenant_isolation
ON budget_ceilings
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);
