-- HEL-13: Canonical companies, missions, and hiring_plans for Supabase.
-- Mirrors migrations/022_companies_missions_hiring_plans.sql.

begin;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

alter table public.companies
  add column if not exists description text;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'user_id'
  ) then
    alter table public.companies alter column user_id drop not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'provisioned_workspace_name'
  ) then
    alter table public.companies alter column provisioned_workspace_name drop not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'provisioned_workspace_slug'
  ) then
    alter table public.companies alter column provisioned_workspace_slug drop not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'team_id'
  ) then
    alter table public.companies alter column team_id drop not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'companies'
       and column_name = 'idempotency_key'
  ) then
    alter table public.companies alter column idempotency_key drop not null;
  end if;
end$$;

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  statement text not null,
  status text not null default 'draft',
  created_by_user_id text not null references public.user_profiles(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.hiring_plans (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  accepted_by_user_id text references public.user_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hiring_plans_acceptance_pair
    check (
      (accepted_at is null and accepted_by_user_id is null)
      or (accepted_at is not null and accepted_by_user_id is not null)
    )
);

create index if not exists idx_companies_workspace_id
  on public.companies (workspace_id);
create index if not exists idx_missions_company_id
  on public.missions (company_id);
create index if not exists idx_missions_created_by_user_id
  on public.missions (created_by_user_id);
create index if not exists idx_missions_status
  on public.missions (status);
create index if not exists idx_hiring_plans_mission_id
  on public.hiring_plans (mission_id);
create index if not exists idx_hiring_plans_accepted_by_user_id
  on public.hiring_plans (accepted_by_user_id)
  where accepted_by_user_id is not null;

alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.missions enable row level security;
alter table public.missions force row level security;
alter table public.hiring_plans enable row level security;
alter table public.hiring_plans force row level security;

drop policy if exists provisioned_companies_tenant_isolation on public.companies;
drop policy if exists companies_tenant_isolation on public.companies;
create policy companies_tenant_isolation
on public.companies
using (
  public.app_current_workspace_id() is not null
  and workspace_id = public.app_current_workspace_id()
)
with check (
  public.app_current_workspace_id() is not null
  and workspace_id = public.app_current_workspace_id()
);

drop policy if exists missions_tenant_isolation on public.missions;
create policy missions_tenant_isolation
on public.missions
using (
  public.app_current_workspace_id() is not null
  and exists (
    select 1
      from public.companies
     where companies.id = missions.company_id
       and companies.workspace_id = public.app_current_workspace_id()
  )
)
with check (
  public.app_current_workspace_id() is not null
  and exists (
    select 1
      from public.companies
     where companies.id = missions.company_id
       and companies.workspace_id = public.app_current_workspace_id()
  )
);

drop policy if exists hiring_plans_tenant_isolation on public.hiring_plans;
create policy hiring_plans_tenant_isolation
on public.hiring_plans
using (
  public.app_current_workspace_id() is not null
  and exists (
    select 1
      from public.missions
      join public.companies on companies.id = missions.company_id
     where missions.id = hiring_plans.mission_id
       and companies.workspace_id = public.app_current_workspace_id()
  )
)
with check (
  public.app_current_workspace_id() is not null
  and exists (
    select 1
      from public.missions
      join public.companies on companies.id = missions.company_id
     where missions.id = hiring_plans.mission_id
       and companies.workspace_id = public.app_current_workspace_id()
  )
);

commit;
