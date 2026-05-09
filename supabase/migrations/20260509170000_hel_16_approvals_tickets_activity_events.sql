-- HEL-16: Canonical approvals + activity_events. Tickets already canonical.
-- Mirrors migrations/024_approvals_tickets_activity_events.sql.

begin;

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.runs(id) on delete cascade,
  step_id text,
  tier text not null
    check (tier in (
      'spend_above_threshold',
      'contracts',
      'public_posts',
      'customer_facing_comms',
      'code_merges_to_prod'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'timed_out')),
  requested_at timestamptz not null default now(),
  decided_by_user_id text references public.user_profiles(user_id) on delete set null,
  decided_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approvals_decision_pair
    check (
      (status in ('pending', 'timed_out')
        and decided_at is null
        and decided_by_user_id is null)
      or (status in ('approved', 'rejected')
        and decided_at is not null
        and decided_by_user_id is not null)
    )
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  actor_kind text not null check (actor_kind in ('user', 'agent', 'system')),
  actor_id text,
  subject_kind text,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_approvals_workspace_id on public.approvals (workspace_id, created_at desc);
create index if not exists idx_approvals_status on public.approvals (workspace_id, status);
create index if not exists idx_approvals_run_id on public.approvals (run_id) where run_id is not null;
create index if not exists idx_approvals_decided_by_user_id on public.approvals (decided_by_user_id) where decided_by_user_id is not null;

create index if not exists idx_activity_events_workspace_recent on public.activity_events (workspace_id, occurred_at desc);
create index if not exists idx_activity_events_kind on public.activity_events (workspace_id, kind, occurred_at desc);
create index if not exists idx_activity_events_subject on public.activity_events (subject_kind, subject_id) where subject_kind is not null;

alter table public.approvals enable row level security;
alter table public.approvals force row level security;
alter table public.activity_events enable row level security;
alter table public.activity_events force row level security;

drop policy if exists approvals_tenant_isolation on public.approvals;
create policy approvals_tenant_isolation
on public.approvals
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

drop policy if exists activity_events_tenant_isolation on public.activity_events;
create policy activity_events_tenant_isolation
on public.activity_events
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

commit;
