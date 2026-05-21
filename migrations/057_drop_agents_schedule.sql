-- HEL-142: drop the unused `agents.schedule` column.
--
-- The column was populated by the API (parser + persistence write) but never
-- consumed by the runtime. Scheduling lives in `routines` exclusively:
--   - routines.schedule_cron / interval → BullMQ repeatable jobs via
--     src/queue/scheduler.ts syncRepeatableJobs()
--   - Live wake-up via wake_events / triagePolicy
--
-- AgentTeamDetail.tsx surfaced this field as a "Schedule" metric which made
-- the dashboard lie to operators — the value was visible but never fired any
-- work. Dropping the field removes the lie + the latent footgun.
--
-- Forward-only migration (per repo convention). Postgres does not support
-- transactional rollback of column drops anyway.

ALTER TABLE agents DROP COLUMN IF EXISTS schedule;
