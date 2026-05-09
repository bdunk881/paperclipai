-- Migration 022: Canonical companies, missions, and hiring_plans (HEL-13)
--
-- Establishes the schema-level nouns for the first customer loop:
-- workspace -> companies -> missions -> hiring_plans.
--
-- `companies` already exists on upgraded databases as the post-021 rename of
-- `provisioned_companies`. This migration keeps those live provisioning
-- columns for backwards compatibility, but relaxes them so new canonical
-- company rows can be created with only the HEL-13 fields.

BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS description text;

-- Legacy provisioning columns from the pre-canonical companies table are no
-- longer required to create a company record in the product model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'companies'
       AND column_name = 'user_id'
  ) THEN
    ALTER TABLE companies ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'companies'
       AND column_name = 'provisioned_workspace_name'
  ) THEN
    ALTER TABLE companies ALTER COLUMN provisioned_workspace_name DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'companies'
       AND column_name = 'provisioned_workspace_slug'
  ) THEN
    ALTER TABLE companies ALTER COLUMN provisioned_workspace_slug DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'companies'
       AND column_name = 'team_id'
  ) THEN
    ALTER TABLE companies ALTER COLUMN team_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'companies'
       AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE companies ALTER COLUMN idempotency_key DROP NOT NULL;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  statement text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by_user_id text NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hiring_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz,
  accepted_by_user_id text REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiring_plans_acceptance_pair
    CHECK (
      (accepted_at IS NULL AND accepted_by_user_id IS NULL)
      OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_companies_workspace_id
  ON companies (workspace_id);
CREATE INDEX IF NOT EXISTS idx_missions_company_id
  ON missions (company_id);
CREATE INDEX IF NOT EXISTS idx_missions_created_by_user_id
  ON missions (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_missions_status
  ON missions (status);
CREATE INDEX IF NOT EXISTS idx_hiring_plans_mission_id
  ON hiring_plans (mission_id);
CREATE INDEX IF NOT EXISTS idx_hiring_plans_accepted_by_user_id
  ON hiring_plans (accepted_by_user_id)
  WHERE accepted_by_user_id IS NOT NULL;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions FORCE ROW LEVEL SECURITY;
ALTER TABLE hiring_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provisioned_companies_tenant_isolation ON companies;
DROP POLICY IF EXISTS companies_tenant_isolation ON companies;
CREATE POLICY companies_tenant_isolation
ON companies
USING (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND workspace_id = app_current_workspace_id()
);

DROP POLICY IF EXISTS missions_tenant_isolation ON missions;
CREATE POLICY missions_tenant_isolation
ON missions
USING (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM companies
     WHERE companies.id = missions.company_id
       AND companies.workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM companies
     WHERE companies.id = missions.company_id
       AND companies.workspace_id = app_current_workspace_id()
  )
);

DROP POLICY IF EXISTS hiring_plans_tenant_isolation ON hiring_plans;
CREATE POLICY hiring_plans_tenant_isolation
ON hiring_plans
USING (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM missions
      JOIN companies ON companies.id = missions.company_id
     WHERE missions.id = hiring_plans.mission_id
       AND companies.workspace_id = app_current_workspace_id()
  )
)
WITH CHECK (
  app_current_workspace_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM missions
      JOIN companies ON companies.id = missions.company_id
     WHERE missions.id = hiring_plans.mission_id
       AND companies.workspace_id = app_current_workspace_id()
  )
);

COMMIT;
