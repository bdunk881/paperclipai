-- HEL-17: Canonical connector_connections, llm_credentials extension,
-- budgets, subscriptions, entitlements.
-- Mirrors migrations/025_connectors_llm_budgets_subscriptions_entitlements.sql.

begin;

alter table public.llm_credentials
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists key_ref text,
  add column if not exists validated_at timestamptz,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'invalid', 'rotated', 'revoked'));

create index if not exists idx_llm_credentials_workspace_id
  on public.llm_credentials (workspace_id) where workspace_id is not null;

alter table public.llm_credentials enable row level security;
alter table public.llm_credentials force row level security;

drop policy if exists llm_credentials_tenant_isolation on public.llm_credentials;
create policy llm_credentials_tenant_isolation
on public.llm_credentials
using (
  workspace_id is null
  or (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  )
)
with check (
  workspace_id is null
  or (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  )
);

create table if not exists public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  oauth_token_ref text,
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'failed', 'pending')),
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, kind)
);

create index if not exists idx_connector_connections_workspace_id on public.connector_connections (workspace_id);
create index if not exists idx_connector_connections_status on public.connector_connections (workspace_id, status);

alter table public.connector_connections enable row level security;
alter table public.connector_connections force row level security;

drop policy if exists connector_connections_tenant_isolation on public.connector_connections;
create policy connector_connections_tenant_isolation
on public.connector_connections
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('workspace', 'agent')),
  scope_id uuid not null,
  cap_cents integer not null check (cap_cents >= 0),
  period text not null default 'monthly'
    check (period in ('daily', 'weekly', 'monthly', 'lifetime')),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, scope_kind, scope_id, period)
);

create index if not exists idx_budgets_workspace_id on public.budgets (workspace_id);
create index if not exists idx_budgets_scope on public.budgets (scope_kind, scope_id);

alter table public.budgets enable row level security;
alter table public.budgets force row level security;

drop policy if exists budgets_tenant_isolation on public.budgets;
create policy budgets_tenant_isolation
on public.budgets
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  tier text not null default 'free'
    check (tier in ('free', 'flow', 'automate', 'scale', 'enterprise')),
  status text not null default 'inactive'
    check (status in (
      'inactive', 'trialing', 'active', 'past_due',
      'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
    )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_stripe_customer
  on public.subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists idx_subscriptions_stripe_subscription
  on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists idx_subscriptions_status on public.subscriptions (status);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

drop policy if exists subscriptions_tenant_isolation on public.subscriptions;
create policy subscriptions_tenant_isolation
on public.subscriptions
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature text not null,
  limit_value integer check (limit_value is null or limit_value >= 0),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'subscription'
    check (source in ('subscription', 'override', 'trial', 'comp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, feature)
);

create index if not exists idx_entitlements_workspace_id on public.entitlements (workspace_id);
create index if not exists idx_entitlements_feature on public.entitlements (feature);

alter table public.entitlements enable row level security;
alter table public.entitlements force row level security;

drop policy if exists entitlements_tenant_isolation on public.entitlements;
create policy entitlements_tenant_isolation
on public.entitlements
using (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
)
with check (
  app_current_workspace_id() is not null
  and workspace_id = app_current_workspace_id()
);

commit;
