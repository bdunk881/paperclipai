-- ALT-2321 Phase 1b draft RLS expansion for Supabase review.
--
-- This file is intentionally a review artifact, not a production-ready rollout.
-- Brad should review the policy families here before they are promoted beyond
-- the migration branch.
--
-- Design goals:
--   * preserve the existing workspace-scoped policy shape already used in the dump
--   * add direct user ownership for per-user configuration/history tables
--   * scope child tables through parent records where the parent already carries tenancy
--   * deny client access to internal/service-only tables by enabling RLS without
--     permissive policies

begin;

-- Workspace-scoped tables
alter table public.approval_tier_policies enable row level security;
create policy approval_tier_policies_tenant_isolation
  on public.approval_tier_policies
  using (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  )
  with check (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  );

alter table public.notification_channel_configs enable row level security;
create policy notification_channel_configs_tenant_isolation
  on public.notification_channel_configs
  using (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  )
  with check (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  );

alter table public.notification_deliveries enable row level security;
create policy notification_deliveries_tenant_isolation
  on public.notification_deliveries
  using (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  )
  with check (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  );

alter table public.notification_events enable row level security;
create policy notification_events_tenant_isolation
  on public.notification_events
  using (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  )
  with check (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  );

alter table public.notification_preferences enable row level security;
create policy notification_preferences_tenant_isolation
  on public.notification_preferences
  using (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  )
  with check (
    public.app_current_workspace_id() is not null
    and workspace_id = public.app_current_workspace_id()
  );

-- User-scoped tables
alter table public.user_profiles enable row level security;
create policy user_profiles_owner_isolation
  on public.user_profiles
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

alter table public.llm_configs enable row level security;
create policy llm_configs_owner_isolation
  on public.llm_configs
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

alter table public.connector_credentials enable row level security;
create policy connector_credentials_owner_isolation
  on public.connector_credentials
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

alter table public.generated_reports enable row level security;
create policy generated_reports_owner_isolation
  on public.generated_reports
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

alter table public.memory_entries enable row level security;
create policy memory_entries_owner_isolation
  on public.memory_entries
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

alter table public.workflow_runs enable row level security;
create policy workflow_runs_owner_isolation
  on public.workflow_runs
  using (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  )
  with check (
    public.app_current_user_id() is not null
    and user_id = public.app_current_user_id()
  );

-- Parent-inherited tables
alter table public.ticket_assignments enable row level security;
create policy ticket_assignments_ticket_inheritance
  on public.ticket_assignments
  using (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_assignments.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  )
  with check (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_assignments.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  );

alter table public.ticket_notifications enable row level security;
create policy ticket_notifications_ticket_inheritance
  on public.ticket_notifications
  using (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_notifications.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  )
  with check (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_notifications.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  );

alter table public.ticket_updates enable row level security;
create policy ticket_updates_ticket_inheritance
  on public.ticket_updates
  using (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_updates.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  )
  with check (
    exists (
      select 1
      from public.tickets
      where tickets.id = ticket_updates.ticket_id
        and public.app_current_workspace_id() is not null
        and tickets.workspace_id = public.app_current_workspace_id()
    )
  );

alter table public.workflow_queue_jobs enable row level security;
create policy workflow_queue_jobs_run_inheritance
  on public.workflow_queue_jobs
  using (
    exists (
      select 1
      from public.workflow_runs
      where workflow_runs.id = workflow_queue_jobs.run_id
        and public.app_current_user_id() is not null
        and workflow_runs.user_id = public.app_current_user_id()
    )
  )
  with check (
    exists (
      select 1
      from public.workflow_runs
      where workflow_runs.id = workflow_queue_jobs.run_id
        and public.app_current_user_id() is not null
        and workflow_runs.user_id = public.app_current_user_id()
    )
  );

alter table public.workflow_step_results enable row level security;
create policy workflow_step_results_run_inheritance
  on public.workflow_step_results
  using (
    exists (
      select 1
      from public.workflow_runs
      where workflow_runs.id = workflow_step_results.run_id
        and public.app_current_user_id() is not null
        and workflow_runs.user_id = public.app_current_user_id()
    )
  )
  with check (
    exists (
      select 1
      from public.workflow_runs
      where workflow_runs.id = workflow_step_results.run_id
        and public.app_current_user_id() is not null
        and workflow_runs.user_id = public.app_current_user_id()
    )
  );

alter table public.approval_requests enable row level security;
create policy approval_requests_requestor_or_assignee
  on public.approval_requests
  using (
    public.app_current_user_id() is not null
    and (
      user_id = public.app_current_user_id()
      or assignee = public.app_current_user_id()
    )
  )
  with check (
    public.app_current_user_id() is not null
    and (
      user_id = public.app_current_user_id()
      or assignee = public.app_current_user_id()
    )
  );

alter table public.approval_notifications enable row level security;
create policy approval_notifications_request_inheritance
  on public.approval_notifications
  using (
    exists (
      select 1
      from public.approval_requests
      where approval_requests.id = approval_notifications.approval_request_id
        and public.app_current_user_id() is not null
        and (
          approval_requests.user_id = public.app_current_user_id()
          or approval_requests.assignee = public.app_current_user_id()
          or approval_notifications.recipient = public.app_current_user_id()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.approval_requests
      where approval_requests.id = approval_notifications.approval_request_id
        and public.app_current_user_id() is not null
        and (
          approval_requests.user_id = public.app_current_user_id()
          or approval_requests.assignee = public.app_current_user_id()
          or approval_notifications.recipient = public.app_current_user_id()
        )
    )
  );

-- Service-role-only tables.
-- Enabling RLS without permissive policies denies anon/authenticated access while
-- leaving service-role and migration paths available.
alter table public.agent_heartbeat_logs enable row level security;
alter table public.agent_memory_entries enable row level security;
alter table public.agent_memory_events enable row level security;
alter table public.agent_memory_kg_facts enable row level security;
alter table public.control_plane_company_lifecycle enable row level security;
alter table public.control_plane_company_lifecycle_audit enable row level security;
alter table public.social_auth_users enable row level security;

commit;
