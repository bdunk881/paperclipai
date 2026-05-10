-- HEL-67: stripe_webhook_events idempotency table.
-- Mirrors migrations/029_stripe_webhook_events.sql.

begin;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created timestamptz not null,
  resource_id text,
  processed_at timestamptz not null default now()
);

create index if not exists idx_stripe_webhook_events_resource
  on public.stripe_webhook_events (resource_id, event_created desc)
  where resource_id is not null;

create index if not exists idx_stripe_webhook_events_processed_at
  on public.stripe_webhook_events (processed_at desc);

commit;
