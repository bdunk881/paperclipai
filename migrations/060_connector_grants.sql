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
  created_by uuid references auth.users(id),
  unique (workspace_id, connector_id, scope_kind, scope_id)
);
alter table connector_grants enable row level security;
alter table connector_grants force row level security;
create policy connector_grants_workspace_isolation on connector_grants
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create index on connector_grants (workspace_id, connector_id);
