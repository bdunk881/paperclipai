-- System-notice opt-out list (HEL-366) — recipients who unsubscribed from
-- maintenance / incident "system status notice" emails.
--
-- This is a CATEGORY opt-out: it is consulted ONLY by the system-status-notice
-- blast, never by the mailer's per-send suppression check. So a recipient who
-- opts out of maintenance notices still receives critical billing / auth mail
-- (those go straight through the mailer, which never reads this table).
--
-- Global (not workspace-scoped): keyed by lowercased email. Written by the
-- token-gated public unsubscribe endpoint (no session) and read by the
-- platform-admin blast. There is no tenant to scope by, so the RLS policy is
-- intentionally permissive — the app role is non-owner, so force RLS still
-- applies; the policy just lets the app read/write this global, non-tenant table.

create table if not exists system_notice_opt_outs (
  email text primary key,
  source text,
  created_at timestamptz not null default now()
);

alter table system_notice_opt_outs enable row level security;
alter table system_notice_opt_outs force row level security;

drop policy if exists system_notice_opt_outs_app on system_notice_opt_outs;
create policy system_notice_opt_outs_app on system_notice_opt_outs
  using (true)
  with check (true);
