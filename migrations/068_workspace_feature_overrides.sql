-- Migration 068: per-workspace feature-flag overrides.
--
-- The existing entitlements layer (src/billing/entitlements.ts) gates feature
-- access by plan. Support occasionally needs to flip a flag for one workspace
-- without changing their plan (early access, partner pilot, hot-fix bypass).
-- This table is the override surface; entitlements.ts joins against it.

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_feature_overrides (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flag text NOT NULL CHECK (length(flag) > 0 AND length(flag) <= 64),
  enabled boolean NOT NULL,
  set_by_admin_id text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  PRIMARY KEY (workspace_id, flag)
);

-- HEL-277: Partial index narrowed to never-expiring overrides (the common
-- case). The original predicate `WHERE expires_at IS NULL OR expires_at > now()`
-- fails Postgres's IMMUTABLE-function requirement for index predicates because
-- `now()` is STABLE, not IMMUTABLE — that crashed every autoflow-api-dev boot
-- after v148. Queries filtering by the full active condition still benefit
-- from this index for the no-expiry case; rows with a future `expires_at`
-- fall back to the PK `(workspace_id, flag)`. Do NOT add `now()` back here.
CREATE INDEX IF NOT EXISTS idx_workspace_feature_overrides_active
  ON workspace_feature_overrides (workspace_id, flag)
  WHERE expires_at IS NULL;

ALTER TABLE workspace_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_feature_overrides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_feature_overrides_admin_only
  ON workspace_feature_overrides;
CREATE POLICY workspace_feature_overrides_admin_only
  ON workspace_feature_overrides
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
