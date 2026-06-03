-- HEL-467 (B8): durable per-scope daily usage counters
-- ----------------------------------------------------
-- Replaces the process-local in-memory Maps that enforced daily quotas
-- (hosted-free token cap, agent-memory semantic-search limit). Those
-- counters were per-instance and reset on restart, so on a multi-machine
-- deploy each instance got its own allowance and a deploy wiped the count.
--
-- This table is the durable source of truth. The application reads through
-- a short-TTL Redis cache (keyed identically) but every increment is the
-- atomic upsert below, so the running total is correct across instances.
--
-- `scope_id` is generic: it holds a workspace id for `hosted_free_tokens`
-- and a user id for `semantic_search`. `day_key` is a UTC `YYYY-MM-DD`
-- string so the counter rolls over at UTC midnight with no cron.
--
-- Server-only (written via the API's DATABASE_URL connection); not exposed
-- to anon/authenticated Supabase clients.

CREATE TABLE IF NOT EXISTS daily_usage (
  scope_id   text        NOT NULL,
  metric     text        NOT NULL,
  day_key    text        NOT NULL,
  amount     bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, metric, day_key)
);

-- Lets a daily cleanup job prune old rows efficiently.
CREATE INDEX IF NOT EXISTS daily_usage_day_key_idx
  ON daily_usage (day_key);

COMMENT ON TABLE daily_usage IS
  'Durable per-scope daily usage counters (HEL-467). scope_id = workspace or user id depending on metric; day_key = UTC YYYY-MM-DD. Source of truth behind a Redis read-cache.';
