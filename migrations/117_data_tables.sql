-- Migration 117: built-in workflow data tables (HEL-812 / HEL-713).
--
-- Per-workspace, user-defined tables + rows so a workflow can persist state
-- across runs without an external DB (the n8n "Data Tables" pattern) —
-- insert / upsert (by row_key) / query.
--
-- workspace_id is uuid (matches app_current_workspace_id()'s return type), so
-- the RLS compare needs no ::text cast — avoids the HEL-804 text=uuid trap.
-- The backend connects BYPASSRLS (the store's WHERE clause is the live filter);
-- these policies are defense-in-depth for any authenticated-role path.
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS before each CREATE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.data_tables (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.data_table_rows (
  id           uuid PRIMARY KEY,
  table_id     uuid NOT NULL REFERENCES public.data_tables(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  row_key      text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_table_rows_table_idx
  ON public.data_table_rows (table_id);

-- upsert key: at most one row per (table, row_key) when a key is given.
CREATE UNIQUE INDEX IF NOT EXISTS data_table_rows_key_uniq
  ON public.data_table_rows (table_id, row_key)
  WHERE row_key IS NOT NULL;

ALTER TABLE public.data_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_table_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_tables_workspace_isolation ON public.data_tables;
CREATE POLICY data_tables_workspace_isolation ON public.data_tables
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id());

DROP POLICY IF EXISTS data_table_rows_workspace_isolation ON public.data_table_rows;
CREATE POLICY data_table_rows_workspace_isolation ON public.data_table_rows
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id())
  WITH CHECK (app_current_workspace_id() IS NOT NULL AND workspace_id = app_current_workspace_id());

COMMIT;

-- ============================================================================
-- ROLLBACK:
-- BEGIN;
-- DROP TABLE IF EXISTS public.data_table_rows;
-- DROP TABLE IF EXISTS public.data_tables;
-- COMMIT;
-- ============================================================================
