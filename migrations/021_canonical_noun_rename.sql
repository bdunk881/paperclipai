-- Migration 021: Canonical noun rename — drop control_plane_ prefix on customer surfaces (HEL-43)
--
-- Renames all customer-visible tables to their approved canonical names so the
-- domain model in code, docs, and the database schema agree. The
-- `src/controlPlane/` module directory is intentionally left as-is (it is an
-- internal implementation detail, not a customer surface).
--
-- Rename map:
--   provisioned_companies                 → companies
--   control_plane_agents                  → agents
--   control_plane_teams                   → agent_teams
--   control_plane_executions              → agent_executions
--   control_plane_tasks                   → agent_tasks
--   control_plane_heartbeats              → agent_heartbeats
--   control_plane_spend_entries           → spend_entries
--   control_plane_budget_alerts           → budget_alerts
--   control_plane_audit_log               → audit_log
--   control_plane_company_lifecycle       → company_lifecycle
--   control_plane_company_lifecycle_audit → company_lifecycle_audit  (no workspace_id; cannot fold into audit_log)
--   llm_configs                           → llm_credentials
--
-- Additionally folds control_plane_secret_audit into audit_log (the unified
-- ledger) and drops the legacy per-phase table.
--
-- RLS policies and indexes follow their parent table automatically when a table
-- is renamed in PostgreSQL; no ALTER POLICY or DROP/CREATE INDEX is needed.
--
-- Tables intentionally NOT renamed (live code still uses the old names and
-- renaming them is tracked as a separate workstream):
--   agent_heartbeat_logs  — agentMemoryStore.ts manages its own DDL
--   memory_entries        — runtimeRetention.ts still references it
--   observability_events  — observability/store.ts still references it
--   provisioned_company_secrets — secrets table; FK to `companies` auto-updates

BEGIN;

-- ============================================================
-- Part 1: Simple table renames
-- ============================================================

ALTER TABLE IF EXISTS provisioned_companies RENAME TO companies;
ALTER TABLE IF EXISTS control_plane_agents RENAME TO agents;
ALTER TABLE IF EXISTS control_plane_teams RENAME TO agent_teams;
ALTER TABLE IF EXISTS control_plane_executions RENAME TO agent_executions;
ALTER TABLE IF EXISTS control_plane_tasks RENAME TO agent_tasks;
ALTER TABLE IF EXISTS control_plane_heartbeats RENAME TO agent_heartbeats;
ALTER TABLE IF EXISTS control_plane_spend_entries RENAME TO spend_entries;
ALTER TABLE IF EXISTS control_plane_budget_alerts RENAME TO budget_alerts;
ALTER TABLE IF EXISTS control_plane_audit_log RENAME TO audit_log;
ALTER TABLE IF EXISTS control_plane_company_lifecycle RENAME TO company_lifecycle;
ALTER TABLE IF EXISTS control_plane_company_lifecycle_audit RENAME TO company_lifecycle_audit;
ALTER TABLE IF EXISTS llm_configs RENAME TO llm_credentials;

-- ============================================================
-- Part 2: Fold control_plane_secret_audit into audit_log
-- ============================================================
-- Map the per-phase secret audit ledger into the unified audit_log so
-- compliance reviewers have one place to look. Schema mapping:
--   workspace_id   → workspace_id
--   actor_user_id  → actor_user_id
--   actor_agent_id → actor_agent_id
--   (derived)      → category = 'secret'
--   action         → action  (read/read_failed/write/rotate/delete/list — all ≤ 64 chars)
--   (derived)      → target_type = 'company'
--   company_id     → target_id (cast to text)
--   key+key_version+metadata → metadata (JSONB)
--   at             → at
--
-- The actor_present CHECK on audit_log matches the constraint added in
-- migration 018, so no rows should be rejected.

INSERT INTO audit_log (
  workspace_id,
  actor_user_id,
  actor_agent_id,
  category,
  action,
  target_type,
  target_id,
  metadata,
  at
)
SELECT
  workspace_id,
  actor_user_id,
  actor_agent_id,
  'secret'::text,
  action,
  'company'::text,
  company_id::text,
  jsonb_build_object(
    'key',          key,
    'key_version',  key_version,
    'extra',        COALESCE(metadata, '{}'::jsonb)
  ),
  at
FROM control_plane_secret_audit
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS control_plane_secret_audit;

COMMIT;
