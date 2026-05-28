-- Migration 086 (HEL-298): allow a workspace to read its own feature-override row.
--
-- Background: migration 068 created `workspace_feature_overrides` with
-- `FORCE ROW LEVEL SECURITY` and a single policy gating reads/writes on
-- `app_is_platform_admin()`. This was fine when only the admin console
-- wrote/read overrides — but HEL-280 added a runtime read path
-- (`isWorkspaceFlagEnabled` in `src/security/workspaceFeatureFlags.ts`)
-- called from every authenticated user request to evaluate the OAuth-skip
-- override. From a normal user's session that read always returned zero
-- rows, silently defaulting the knob to "off". (Default OFF happens to
-- be what we want for OAuth users — `requiresAppMfa = false` — but it
-- also means the enterprise override is dead.)
--
-- This migration adds a permissive SELECT policy that lets the user read
-- the row for their CURRENT workspace context (set by
-- `withWorkspaceContext` → `SET LOCAL app.current_workspace_id`). Writes
-- stay admin-only.
--
-- Why not bypass via a service-role pool? We already have all the
-- workspace GUC plumbing wired up in middleware/workspaceContext.ts.
-- Adding a SECOND postgres pool with elevated privileges (a) doubles
-- connection-count budget on Supabase, (b) creates a privileged path
-- with no audit, (c) requires a new env var. RLS with a narrow
-- workspace-self-read policy is the least-blast-radius option.

BEGIN;

DROP POLICY IF EXISTS workspace_feature_overrides_workspace_self_read
  ON workspace_feature_overrides;

CREATE POLICY workspace_feature_overrides_workspace_self_read
  ON workspace_feature_overrides
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    app_current_workspace_id() IS NOT NULL
    AND workspace_id = app_current_workspace_id()
  );

COMMIT;
