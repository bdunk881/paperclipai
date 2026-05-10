-- HEL-14: agent_assignments + org_edges + agents.company_id.
-- Mirrors migrations/031_agent_assignments_org_edges.sql.

begin;

alter table public.agents
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists idx_agents_company_id
  on public.agents (company_id) where company_id is not null;

create table if not exists public.agent_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (agent_id, routine_id)
);

create index if not exists idx_agent_assignments_workspace_id
  on public.agent_assignments (workspace_id);
create index if not exists idx_agent_assignments_routine_id
  on public.agent_assignments (routine_id);

alter table public.agent_assignments enable row level security;
alter table public.agent_assignments force row level security;

drop policy if exists agent_assignments_tenant_isolation on public.agent_assignments;
create policy agent_assignments_tenant_isolation
on public.agent_assignments
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

create table if not exists public.org_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  manager_agent_id uuid not null references public.agents(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (manager_agent_id, agent_id),
  constraint org_edges_no_self_loop check (manager_agent_id <> agent_id)
);

create index if not exists idx_org_edges_workspace_id on public.org_edges (workspace_id);
create index if not exists idx_org_edges_agent_id on public.org_edges (agent_id);
create index if not exists idx_org_edges_manager_agent_id on public.org_edges (manager_agent_id);

alter table public.org_edges enable row level security;
alter table public.org_edges force row level security;

drop policy if exists org_edges_tenant_isolation on public.org_edges;
create policy org_edges_tenant_isolation
on public.org_edges
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

create or replace function public.org_edges_assert_no_cycle()
returns trigger
language plpgsql
as $$
begin
  if exists (
    with recursive chain(ancestor_id) as (
      select new.manager_agent_id
      union all
      select oe.manager_agent_id
        from public.org_edges oe
        join chain c on oe.agent_id = c.ancestor_id
    )
    select 1 from chain where ancestor_id = new.agent_id
  ) then
    raise exception 'org_edges cycle detected: agent % is already an ancestor of manager %',
      new.agent_id, new.manager_agent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists org_edges_no_cycle on public.org_edges;
create trigger org_edges_no_cycle
  before insert or update on public.org_edges
  for each row execute function public.org_edges_assert_no_cycle();

commit;
