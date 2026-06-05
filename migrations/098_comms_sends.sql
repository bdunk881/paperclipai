-- Comms gateway foundation — project "Comms gateway + managed comms (SMS, voice, Layer C)".
--
-- The append-only ledger behind src/comms/gateway.ts. Every comms.send()
-- attempt writes exactly one row here and transitions queued -> sent | failed
-- | suppressed. The (workspace_id, idempotency_key) unique index is the dedup
-- primitive: a repeated key is a no-op that returns the prior row instead of
-- re-sending (the gateway checks first; the index is the race-proof backstop).
--
-- Spend attribution (comms_spend_entries), BullMQ retry/DLQ, and inbound
-- webhooks land in follow-up tickets — this migration is just the ledger.

create table if not exists comms_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Attribution columns. Nullable, and intentionally without FKs for now so
  -- this table stays decoupled from the agents/missions schema; the
  -- spend-attribution ticket can tighten these.
  agent_id uuid,
  mission_id uuid,
  kind text not null check (kind in ('auth','system','customer')),
  channel text not null check (channel in ('email','sms','voice')),
  to_address text not null,
  template text,
  provider text,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','suppressed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Idempotency: one logical send per (workspace, key).
create unique index if not exists comms_sends_workspace_idempotency_idx
  on comms_sends (workspace_id, idempotency_key);

-- Listing / ledger scans, newest first.
create index if not exists comms_sends_workspace_created_idx
  on comms_sends (workspace_id, created_at desc);

alter table comms_sends enable row level security;
alter table comms_sends force row level security;

-- Workspace-scoped via the app_current_workspace_id() / withWorkspaceContext()
-- pattern (migrations 014, 017, 061, 063, 064). Writers set the workspace
-- context through withWorkspaceContext(pool, { workspaceId, userId }, ...).
drop policy if exists comms_sends_ws on comms_sends;
create policy comms_sends_ws on comms_sends
  using (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  )
  with check (
    app_current_workspace_id() is not null
    and workspace_id = app_current_workspace_id()
  );
