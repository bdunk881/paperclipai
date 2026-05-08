-- HEL-43: Canonical noun rename — Supabase-managed schema (mirrors migrations/021_canonical_noun_rename.sql)
--
-- Apply this against the Supabase project AFTER the app-server migration 021
-- has been applied to the same database, OR as part of the initial Supabase
-- bootstrap if starting fresh from this state.
--
-- See migrations/021_canonical_noun_rename.sql for the full rename map and rationale.

ALTER TABLE IF EXISTS public.provisioned_companies RENAME TO companies;
ALTER TABLE IF EXISTS public.control_plane_agents RENAME TO agents;
ALTER TABLE IF EXISTS public.control_plane_teams RENAME TO agent_teams;
ALTER TABLE IF EXISTS public.control_plane_executions RENAME TO agent_executions;
ALTER TABLE IF EXISTS public.control_plane_tasks RENAME TO agent_tasks;
ALTER TABLE IF EXISTS public.control_plane_heartbeats RENAME TO agent_heartbeats;
ALTER TABLE IF EXISTS public.control_plane_spend_entries RENAME TO spend_entries;
ALTER TABLE IF EXISTS public.control_plane_budget_alerts RENAME TO budget_alerts;
ALTER TABLE IF EXISTS public.control_plane_audit_log RENAME TO audit_log;
ALTER TABLE IF EXISTS public.control_plane_company_lifecycle RENAME TO company_lifecycle;
ALTER TABLE IF EXISTS public.control_plane_company_lifecycle_audit RENAME TO company_lifecycle_audit;
ALTER TABLE IF EXISTS public.llm_configs RENAME TO llm_credentials;

-- Fold control_plane_secret_audit into audit_log and drop it.
INSERT INTO public.audit_log (
  workspace_id,
  actor_user_id,
  actor_agent_id,
  category,
  action,
  target_type,
  target_id,
  metadata,
  at
)
SELECT
  workspace_id,
  actor_user_id,
  actor_agent_id,
  'secret'::text,
  action,
  'company'::text,
  company_id::text,
  jsonb_build_object(
    'key',         key,
    'key_version', key_version,
    'extra',       COALESCE(metadata, '{}'::jsonb)
  ),
  at
FROM public.control_plane_secret_audit
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS public.control_plane_secret_audit;
