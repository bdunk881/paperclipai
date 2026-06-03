-- Migration 096: file_objects — first-party object-storage metadata index (HEL-353).
--
-- Storage foundation Tier A. The storage adapter (HEL-352, code in src/storage/)
-- moves bytes; this table is the workspace-scoped metadata index every consumer
-- binds to: file routes (HEL-354), run inputs (HEL-355), workspace-deletion
-- cleanup (HEL-356), observability exports (HEL-357), lifecycle/retention
-- (HEL-358), and audit (HEL-359).
--
-- SECURITY: Supabase/Postgres RLS protects rows but NOT the object store, so
-- this table is the tenancy anchor. Workspace-scoped RLS (per the Phase-4
-- pattern in migration 087) ensures Sally cannot SELECT/UPDATE/DELETE rows from
-- George's workspace even with crafted queries; the signed-URL endpoint
-- (HEL-354) re-resolves fileId -> row under the requester's workspace context.
--
-- NOTE on `uploaded_by`: the ticket says `uuid`, but user identifiers in this
-- codebase are text (Supabase sub) — see user_profiles.user_id,
-- audit_log.actor_user_id, and migration 022's created_by_user_id. A uuid FK
-- would have no valid referent. We therefore use `text REFERENCES
-- user_profiles(user_id)`, mirroring migration 022.

BEGIN;

CREATE TABLE IF NOT EXISTS file_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  collection text NOT NULL,
  storage_key text NOT NULL,
  provider text NOT NULL DEFAULT 'r2' CHECK (provider IN ('r2', 's3')),
  bucket text,
  external_account_id uuid,            -- Tier D personal-cloud connectors (companion project)
  kms_key_id text,                     -- Tier B per-workspace KMS (companion project)
  filename text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_class text NOT NULL DEFAULT 'standard'
    CHECK (retention_class IN ('short', 'standard', 'legal_hold')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT file_objects_storage_key_unique UNIQUE (storage_key)
);

-- (workspace_id, collection) also serves workspace-only lookups + the
-- workspace_id FK cascade via its leading column.
CREATE INDEX IF NOT EXISTS idx_file_objects_workspace_collection
  ON file_objects (workspace_id, collection);
-- Live-object listing + workspace-deletion enumeration (HEL-356) only ever
-- care about not-yet-tombstoned rows.
CREATE INDEX IF NOT EXISTS idx_file_objects_workspace_active
  ON file_objects (workspace_id)
  WHERE deleted_at IS NULL;

-- Row-Level Security: workspace isolation + platform-admin debug-read, matching
-- the Phase-4 pattern (migration 087). FORCE so the table owner cannot bypass.
ALTER TABLE file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_objects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS file_objects_workspace_isolation ON file_objects;
CREATE POLICY file_objects_workspace_isolation ON file_objects
  AS PERMISSIVE FOR ALL TO public
  USING (app_current_workspace_id() IS NOT NULL
         AND workspace_id::text = app_current_workspace_id()::text)
  WITH CHECK (app_current_workspace_id() IS NOT NULL
             AND workspace_id::text = app_current_workspace_id()::text);

DROP POLICY IF EXISTS file_objects_admin_read ON file_objects;
CREATE POLICY file_objects_admin_read ON file_objects
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- The non-superuser API role (migration 065, NOBYPASSRLS) needs explicit table
-- privileges. Granted directly so the role works regardless of whether 065's
-- ALTER DEFAULT PRIVILEGES applied in this environment.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_objects TO autoflow_api;

COMMIT;
