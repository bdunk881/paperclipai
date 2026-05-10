-- HEL-66: lookup_team_workspace_id SECURITY DEFINER helper.
-- Mirrors migrations/030_lookup_team_workspace_id.sql.

begin;

create or replace function public.lookup_team_workspace_id(p_team_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select workspace_id from public.agent_teams where id = p_team_id limit 1
$$;

alter function public.lookup_team_workspace_id(uuid) set search_path = public, pg_catalog;

comment on function public.lookup_team_workspace_id(uuid) is
  'HEL-66: SECURITY DEFINER helper. Resolves a team''s workspace_id ' ||
  'without needing a workspace context. Returns NULL if the team does ' ||
  'not exist.';

commit;
