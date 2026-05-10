-- HEL-20: RLS audit — close gaps on P1 tables.
-- Mirrors migrations/027_rls_audit_close_gaps.sql.

begin;

alter table public.workflows         force row level security;
alter table public.workflow_versions force row level security;
alter table public.routines          force row level security;
alter table public.runs              force row level security;
alter table public.step_results      force row level security;

drop policy if exists approvals_workspace_tenant_isolation on public.approvals;
create policy approvals_workspace_tenant_isolation
  on public.approvals
  using (
    app_current_workspace_id() is not null
    and exists (
      select 1 from public.runs
      where runs.id = approvals.run_id
        and runs.workspace_id = app_current_workspace_id()
    )
  )
  with check (
    app_current_workspace_id() is not null
    and exists (
      select 1 from public.runs
      where runs.id = approvals.run_id
        and runs.workspace_id = app_current_workspace_id()
    )
  );

commit;
