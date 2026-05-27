-- HEL-todo: workspaces.updated_at — fixes the PATCH /api/tier-routing 500.
--
-- src/llmConfig/tierRouter.ts::setWorkspaceTierMatrix() has always run
--
--     UPDATE workspaces SET tier_routing = $2, updated_at = now() WHERE id = $1
--
-- but the column was never declared on the workspaces table. Postgres aborts
-- with `column "updated_at" of relation "workspaces" does not exist`, the
-- route returns 500, and the dashboard's Tier routing card surfaces an
-- "Internal server error" toast on every drag-or-tap assign.
--
-- agents / agent_tasks / workflows all carry updated_at already (per their
-- own migrations); workspaces is the only canonical table that's missing it,
-- so this is a one-line additive fix. Idempotent via IF NOT EXISTS so the
-- migration is safe to re-apply through the schema-repair path.

alter table workspaces
  add column if not exists updated_at timestamptz not null default now();
