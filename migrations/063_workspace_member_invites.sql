-- HEL-213 PR I: workspace member invites.
--
-- Backs the InviteMemberModal + POST /api/workspace/members/invite flow.
-- Pending invites live here until the recipient accepts (which writes a
-- workspace_members row, bumps the Stripe sub quantity by 1, and stamps
-- accepted_at) or the row expires (default 7 days).
--
-- Role check intentionally excludes 'owner' — owner is single-seat and
-- transferred via a separate ownership-handoff flow, not via invites.

create table if not exists workspace_member_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','operator','viewer')),
  invited_by uuid references auth.users(id),
  invite_token text not null unique,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

alter table workspace_member_invites enable row level security;
alter table workspace_member_invites force row level security;

create policy invites_ws on workspace_member_invites
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create index on workspace_member_invites (workspace_id);
create index on workspace_member_invites (invite_token);
