-- HEL-460 (B3): durable CRM-data access audit trail (ALT-1409)
-- -------------------------------------------------------------
-- Replaces a process-local in-memory array (`crmAuditLog.ts` `auditLog`) that
-- was lost on every restart, was per-instance on the 2-machine fleet, and grew
-- unbounded. Records which CRM field *categories* were sent to the LLM for each
-- CRM-bearing step — it never stores actual field values (the array columns are
-- category names + counts only).
--
-- Append-only at the application layer. Server-only: written via the API's
-- DATABASE_URL connection from the engine; not exposed to anon/authenticated
-- Supabase clients.

CREATE TABLE IF NOT EXISTS crm_data_access_log (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   text NOT NULL,
  run_id                    text NOT NULL,
  step_id                   text NOT NULL,
  step_kind                 text NOT NULL CHECK (step_kind IN ('llm', 'agent')),
  api_endpoint              text NOT NULL,
  included_field_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_field_categories  jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripped_field_count      integer NOT NULL DEFAULT 0,
  total_field_count         integer NOT NULL DEFAULT 0,
  recorded_at               timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_data_access_log_user_recorded_idx
  ON crm_data_access_log (user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS crm_data_access_log_run_idx
  ON crm_data_access_log (run_id);

COMMENT ON TABLE crm_data_access_log IS
  'Append-only compliance audit of CRM field categories sent to the LLM (ALT-1409 / HEL-460). Never stores actual field values.';
