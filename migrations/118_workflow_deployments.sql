-- Migration 118: workflow environments + deployments (HEL-819 / HEL-701).
--
-- Adds the dev/staging/prod environment model: an append-only deployment log
-- recording which workflow VERSION is deployed to which ENVIRONMENT, plus an
-- `environment` on routines so a scheduled/triggered run executes that env's
-- deployed version (HEL-821). The CURRENT deployment per (workflow, environment)
-- is the most recent row; a rollback is just a new deployment of an older
-- version, so history + rollback fall out of one table.
--
-- workspace_id is uuid (matches app_current_workspace_id()) so the RLS compare
-- needs no ::text cast — avoids the HEL-804 text=uuid crash trap. Backend
-- connects BYPASSRLS (the store's WHERE clause is the live filter); these
-- policies are defense-in-depth, matching migration 117.
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS before each CREATE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workflow_deployments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow_id        uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  environment        text NOT NULL CHECK (environment IN ('dev', 'staging', 'prod')),
  version_id         uuid NOT NULL REFERENCES public.workflow_versions(id) ON DELETE RESTRICT,
  version            integer NOT NULL CHECK (version > 0),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text
);

-- "Current" deployment per (workflow, env) = the most recent row.
CREATE INDEX IF NOT EXISTS idx_workflow_deployments_current
  ON public.workflow_deployments (workflow_id, environment, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_deployments_workspace
  ON public.workflow_deployments (workspace_id);

-- HEL-821: a routine runs in one environment; its scheduled/triggered runs use
-- that env's currently-deployed version (falling back to the workflow's latest
-- when the env has no deployment).
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'dev'
  CHECK (environment IN ('dev', 'staging', 'prod'));

ALTER TABLE public.workflow_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_deployments_workspace_isolation ON public.workflow_deployments;
CREATE POLICY workflow_deployments_workspace_isolation ON public.workflow_deployments
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id());

COMMIT;

-- ============================================================================
-- ROLLBACK:
-- BEGIN;
-- ALTER TABLE public.routines DROP COLUMN IF EXISTS environment;
-- DROP TABLE IF EXISTS public.workflow_deployments;
-- COMMIT;
-- ============================================================================
