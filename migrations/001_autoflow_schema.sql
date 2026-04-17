BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Session helpers used by row-level security policies.
CREATE OR REPLACE FUNCTION app_current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')
$$;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS icp_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_titles text[] NOT NULL DEFAULT ARRAY[]::text[],
  industries text[] NOT NULL DEFAULT ARRAY[]::text[],
  headcount_min integer,
  headcount_max integer,
  geographies text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (headcount_min IS NULL OR headcount_min >= 0),
  CHECK (headcount_max IS NULL OR headcount_max >= 0),
  CHECK (
    headcount_min IS NULL
    OR headcount_max IS NULL
    OR headcount_min <= headcount_max
  )
);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  icp_profile_id uuid REFERENCES icp_profiles(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  company text,
  title text,
  email text,
  enrichment_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_workspace_email_key
  ON leads (workspace_id, lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number > 0),
  status text NOT NULL DEFAULT 'queued',
  sent_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON workspace_members (user_id);

CREATE INDEX IF NOT EXISTS idx_icp_profiles_workspace_id
  ON icp_profiles (workspace_id);

CREATE INDEX IF NOT EXISTS idx_leads_workspace_id
  ON leads (workspace_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id
  ON campaigns (workspace_id);

CREATE INDEX IF NOT EXISTS idx_email_sends_workspace_id
  ON email_sends (workspace_id);

CREATE INDEX IF NOT EXISTS idx_email_sends_campaign_id
  ON email_sends (campaign_id);

CREATE INDEX IF NOT EXISTS idx_email_sends_lead_id
  ON email_sends (lead_id);

-- Keep cross-table tenant boundaries consistent for email_sends records.
CREATE OR REPLACE FUNCTION enforce_email_send_workspace_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  campaign_workspace_id uuid;
  lead_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO campaign_workspace_id FROM campaigns WHERE id = NEW.campaign_id;
  IF campaign_workspace_id IS NULL THEN
    RAISE EXCEPTION 'campaign % does not exist', NEW.campaign_id;
  END IF;

  SELECT workspace_id INTO lead_workspace_id FROM leads WHERE id = NEW.lead_id;
  IF lead_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lead % does not exist', NEW.lead_id;
  END IF;

  IF campaign_workspace_id <> lead_workspace_id THEN
    RAISE EXCEPTION 'campaign % and lead % belong to different workspaces', NEW.campaign_id, NEW.lead_id;
  END IF;

  IF NEW.workspace_id <> campaign_workspace_id THEN
    RAISE EXCEPTION 'email_send workspace_id must match campaign and lead workspace';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_sends_workspace_match ON email_sends;
CREATE TRIGGER trg_email_sends_workspace_match
BEFORE INSERT OR UPDATE ON email_sends
FOR EACH ROW EXECUTE FUNCTION enforce_email_send_workspace_match();

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_tenant_isolation ON workspaces;
CREATE POLICY workspaces_tenant_isolation
ON workspaces
USING (
  id = app_current_workspace_id()
  AND (
    owner_user_id = app_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = app_current_user_id()
    )
  )
)
WITH CHECK (id = app_current_workspace_id());

DROP POLICY IF EXISTS workspace_members_tenant_isolation ON workspace_members;
CREATE POLICY workspace_members_tenant_isolation
ON workspace_members
USING (workspace_id = app_current_workspace_id())
WITH CHECK (workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS icp_profiles_tenant_isolation ON icp_profiles;
CREATE POLICY icp_profiles_tenant_isolation
ON icp_profiles
USING (workspace_id = app_current_workspace_id())
WITH CHECK (workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS leads_tenant_isolation ON leads;
CREATE POLICY leads_tenant_isolation
ON leads
USING (workspace_id = app_current_workspace_id())
WITH CHECK (workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS campaigns_tenant_isolation ON campaigns;
CREATE POLICY campaigns_tenant_isolation
ON campaigns
USING (workspace_id = app_current_workspace_id())
WITH CHECK (workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS email_sends_tenant_isolation ON email_sends;
CREATE POLICY email_sends_tenant_isolation
ON email_sends
USING (workspace_id = app_current_workspace_id())
WITH CHECK (workspace_id = app_current_workspace_id());

COMMIT;
