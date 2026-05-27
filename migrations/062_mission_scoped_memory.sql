-- HEL-207 — Mission-scoped memory (PR D)
--
-- Extends the four memory-bearing tables with a `mission_id` retrieval-relevance
-- tag (NOT a visibility wall — workspace_id remains the source of truth for
-- isolation). The dashboard's new scope picker (`By mission · By team · By
-- agent · Workspace-wide`) filters lists/searches by `memory_layer +
-- mission_id|team_id|agent_id`, so every table needs the column.
--
-- `workspace_instructions`, `knowledge_items`, and `agent_episodes` already
-- carry `mission_id UUID` from migration 034 (three-layer memory). We
-- defensively re-add as `text` for the legacy `agent_memory_entries` table
-- (introduced in 007, never had mission scope) and use `IF NOT EXISTS` so
-- this migration is idempotent against the v2 schema.

alter table agent_memory_entries add column if not exists mission_id text;
alter table workspace_instructions add column if not exists mission_id text;
alter table knowledge_items add column if not exists mission_id text;
alter table agent_episodes add column if not exists mission_id text;

create index if not exists agent_memory_entries_mission_idx on agent_memory_entries (mission_id) where mission_id is not null;
create index if not exists workspace_instructions_mission_idx on workspace_instructions (mission_id) where mission_id is not null;
create index if not exists knowledge_items_mission_idx on knowledge_items (mission_id) where mission_id is not null;
create index if not exists agent_episodes_mission_idx on agent_episodes (mission_id) where mission_id is not null;
