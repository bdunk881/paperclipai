-- HEL-15: Canonical workflows, workflow_versions, routines, runs, step_results
-- Mirrors migrations/023_routines_workflows_runs.sql.

begin;

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  latest_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version integer not null check (version >= 1),
  dag jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by_user_id text references public.user_profiles(user_id) on delete set null,
  unique (workflow_id, version)
);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'workflows'
      and constraint_name = 'workflows_latest_version_fk'
  ) then
    alter table public.workflows
      add constraint workflows_latest_version_fk
      foreign key (latest_version_id) references public.workflow_versions(id) on delete set null;
  end if;
end$$;

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  name text not null,
  schedule_cron text,
  trigger_kind text not null default 'manual'
    check (trigger_kind in ('manual', 'cron', 'webhook', 'event')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  workflow_version_id uuid not null references public.workflow_versions(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval')),
  started_at timestamptz,
  ended_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.step_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  step_id text not null,
  ordinal integer not null check (ordinal >= 0),
  status text not null
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  output jsonb,
  cost_cents integer not null default 0 check (cost_cents >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  unique (run_id, step_id, ordinal)
);

create index if not exists idx_workflows_workspace_id on public.workflows (workspace_id);
create index if not exists idx_workflow_versions_workflow_id on public.workflow_versions (workflow_id, version desc);
create index if not exists idx_routines_workspace_id on public.routines (workspace_id);
create index if not exists idx_routines_agent_id on public.routines (agent_id) where agent_id is not null;
create index if not exists idx_routines_enabled on public.routines (workspace_id, enabled);
create index if not exists idx_runs_workspace_id on public.runs (workspace_id, created_at desc);
create index if not exists idx_runs_routine_id on public.runs (routine_id, created_at desc) where routine_id is not null;
create index if not exists idx_runs_status on public.runs (workspace_id, status);
create index if not exists idx_step_results_run_id on public.step_results (run_id, ordinal);

alter table public.workflows enable row level security;
alter table public.workflows force row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_versions force row level security;
alter table public.routines enable row level security;
alter table public.routines force row level security;
alter table public.runs enable row level security;
alter table public.runs force row level security;
alter table public.step_results enable row level security;
alter table public.step_results force row level security;

drop policy if exists workflows_tenant_isolation on public.workflows;
create policy workflows_tenant_isolation
on public.workflows
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

drop policy if exists workflow_versions_tenant_isolation on public.workflow_versions;
create policy workflow_versions_tenant_isolation
on public.workflow_versions
using (
  app_current_workspace_id() is not null
  and exists (
    select 1 from public.workflows
     where workflows.id = workflow_versions.workflow_id
       and workflows.workspace_id = app_current_workspace_id()
  )
)
with check (
  app_current_workspace_id() is not null
  and exists (
    select 1 from public.workflows
     where workflows.id = workflow_versions.workflow_id
       and workflows.workspace_id = app_current_workspace_id()
  )
);

drop policy if exists routines_tenant_isolation on public.routines;
create policy routines_tenant_isolation
on public.routines
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

drop policy if exists runs_tenant_isolation on public.runs;
create policy runs_tenant_isolation
on public.runs
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

drop policy if exists step_results_tenant_isolation on public.step_results;
create policy step_results_tenant_isolation
on public.step_results
using (
  app_current_workspace_id() is not null
  and exists (
    select 1 from public.runs
     where runs.id = step_results.run_id
       and runs.workspace_id = app_current_workspace_id()
  )
)
with check (
  app_current_workspace_id() is not null
  and exists (
    select 1 from public.runs
     where runs.id = step_results.run_id
       and runs.workspace_id = app_current_workspace_id()
  )
);

commit;
