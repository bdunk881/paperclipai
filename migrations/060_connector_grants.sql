-- Migration 060: Per-scope connector grants for the Connections hub (HEL-205).
--
-- Captures the "which connector is allowed for which scope (mission/team/agent),
-- and at what permission level (allow/ask/deny)?" decision tree surfaced in the
-- per-connector Manage panel. Workspace-scoped + RLS-isolated so grants from one
-- workspace can't leak into another.

create table if not exists connector_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connector_id text not null,
  scope_kind text not null check (scope_kind in ('mission','team','agent')),
  scope_id text not null,
  permission text not null check (permission in ('allow','ask','deny')),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (workspace_id, connector_id, scope_kind, scope_id)
);

-- Attach the auth.users FK only when the Supabase auth schema is present.
-- Dev/CI environments may run a bare Postgres without the auth schema; on
-- those, the FK would be unsatisfiable and the whole migration would abort,
-- crashlooping the API on startup. Production (real Supabase) has both
-- pieces, so the FK lands there exactly as it always did.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'auth' and c.relname = 'users' and c.relkind = 'r'
  ) and not exists (
    select 1 from pg_constraint where conname = 'connector_grants_created_by_fkey'
  ) then
    alter table connector_grants
      add constraint connector_grants_created_by_fkey
      foreign key (created_by) references auth.users(id);
  end if;
end $$;

alter table connector_grants enable row level security;
alter table connector_grants force row level security;
drop policy if exists connector_grants_workspace_isolation on connector_grants;
create policy connector_grants_workspace_isolation on connector_grants
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create index if not exists connector_grants_workspace_connector_idx
  on connector_grants (workspace_id, connector_id);
