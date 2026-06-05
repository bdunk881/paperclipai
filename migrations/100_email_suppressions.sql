-- Email suppression list (HEL-360) — the app-side mailer's deliverability guard.
--
-- Hard bounces and complaints (from the SES SNS webhook, HEL-361) land here, and
-- any sender MUST refuse to deliver to a suppressed recipient. `workspace_id` is
-- NULLABLE: a NULL row is a GLOBAL suppression (applies to every workspace); a
-- non-NULL row is scoped to one workspace. Reads return the workspace's own rows
-- plus global rows.

create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  -- NULL = global suppression (applies to all workspaces).
  workspace_id uuid references workspaces(id) on delete cascade,
  email text not null,
  reason text not null check (reason in ('bounce','complaint','manual','unsubscribe')),
  -- Provenance: e.g. the SES/SNS message id, or the admin user who suppressed it.
  source text,
  created_at timestamptz not null default now()
);

-- One suppression per (scope, email). COALESCE folds a NULL workspace_id to a
-- fixed sentinel so global rows dedupe (a plain UNIQUE treats every NULL as
-- distinct). Email is compared case-insensitively.
create unique index if not exists email_suppressions_scope_email_idx
  on email_suppressions (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));

create index if not exists email_suppressions_email_idx
  on email_suppressions (lower(email));

alter table email_suppressions enable row level security;
alter table email_suppressions force row level security;

-- A workspace sees its own rows + global (NULL) rows. Global writes (from the
-- system bounce webhook, which has no workspace context) satisfy the check via
-- the `workspace_id is null` branch; scoped writes run under withWorkspaceContext.
drop policy if exists email_suppressions_ws on email_suppressions;
create policy email_suppressions_ws on email_suppressions
  using (workspace_id is null or workspace_id = app_current_workspace_id())
  with check (workspace_id is null or workspace_id = app_current_workspace_id());
