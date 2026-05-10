-- HEL-19: Expand workspace_members.role to canonical six roles.
-- Mirrors migrations/026_workspace_member_roles.sql.

begin;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_members'::regclass
      and conname = 'workspace_members_role_check'
  ) then
    alter table public.workspace_members drop constraint workspace_members_role_check;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_members'::regclass
      and conname = 'workspace_members_role_canonical_check'
  ) then
    alter table public.workspace_members drop constraint workspace_members_role_canonical_check;
  end if;

  alter table public.workspace_members
    add constraint workspace_members_role_canonical_check
    check (role in ('owner', 'admin', 'billing', 'operator', 'developer', 'approver', 'member'));
end$$;

create index if not exists idx_workspace_members_workspace_role
  on public.workspace_members (workspace_id, role);

commit;
