-- Comms spend attribution (HEL-611). One row per delivered comms.send, tagged
-- with workspace / agent / mission / channel / provider + units + estimated cost.
-- The gateway records a row (best-effort) after a successful send; the partial
-- unique index on comms_send_id makes it at-most-once per send. Feeds per-
-- workspace / per-agent comms spend rollups alongside the existing LLM
-- spend_entries surface (reuse, don't fork — this is the comms detail table).

create table if not exists comms_spend_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid,
  mission_id uuid,
  comms_send_id uuid,
  channel text not null check (channel in ('email','sms','voice')),
  provider text,
  units integer not null default 1,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);

-- At-most-once per send: the gateway records after markSent, and a retry that
-- finds the row already sent won't re-record — this partial unique index is the
-- race-proof backstop. NULL comms_send_id (non-gateway spend) is exempt.
create unique index if not exists comms_spend_entries_send_idx
  on comms_spend_entries (comms_send_id)
  where comms_send_id is not null;

create index if not exists comms_spend_entries_workspace_created_idx
  on comms_spend_entries (workspace_id, created_at desc);

alter table comms_spend_entries enable row level security;
alter table comms_spend_entries force row level security;

drop policy if exists comms_spend_entries_ws on comms_spend_entries;
create policy comms_spend_entries_ws on comms_spend_entries
  using (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  )
  with check (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  );
