-- HEL-45: Add subscriptionStore-required columns to subscriptions.
-- Mirrors migrations/028_subscription_store_columns.sql.

begin;

alter table public.subscriptions
  add column if not exists user_id text,
  add column if not exists email text,
  add column if not exists current_period_start timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists trial_end timestamptz,
  add column if not exists access_level text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_access_level_check'
  ) then
    alter table public.subscriptions drop constraint subscriptions_access_level_check;
  end if;
  alter table public.subscriptions
    add constraint subscriptions_access_level_check
    check (access_level is null or access_level in ('trial', 'active', 'past_due', 'cancelled', 'none'));
end$$;

create index if not exists idx_subscriptions_user_id
  on public.subscriptions (user_id) where user_id is not null;

commit;
