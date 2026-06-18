-- Migration 113: knowledge bases — user-or-workspace visibility model + RLS.
--
-- HEL-309 — extends the user-only knowledge model (HEL-306 / migration 092)
-- so a knowledge base can be created EITHER user-private (the existing default)
-- OR workspace-visible (readable by every member of, and every agent operating
-- in, the owning workspace). Mirrors the agent-memory scope model.
--
-- HEL-306 / 092 shipped user-isolation RLS keyed on `user_id` (no workspace_id
-- column existed). This migration:
--   1. Adds `workspace_id text` + `scope text` to knowledge_bases (backfill
--      existing rows to scope='user' via the column DEFAULT).
--   2. Replaces knowledge_bases_user_isolation with a user-OR-workspace policy.
--   3. Replaces the child-table user-isolation policies (knowledge_documents,
--      knowledge_chunks, knowledge_embeddings) with a join-through-parent policy
--      so a workspace KB's children inherit its visibility — the same
--      JOIN-through-parent pattern migration 084 used for step_results→runs.
--
-- The backend connects via the BYPASSRLS postgres role (DATABASE_URL), so these
-- policies are defense-in-depth for any PostgREST/authenticated-role path; the
-- live filter for backend reads is the WHERE clause in knowledgeStore.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraint creation, and
-- DROP POLICY IF EXISTS before each CREATE — safe to re-run.

BEGIN;

-- ============================================================================
-- 1. Schema: add scope + workspace_id to knowledge_bases
-- ============================================================================

ALTER TABLE public.knowledge_bases ADD COLUMN IF NOT EXISTS workspace_id text;
ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user';

-- scope ∈ {user, workspace}
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_bases_scope_check'
  ) THEN
    ALTER TABLE public.knowledge_bases
      ADD CONSTRAINT knowledge_bases_scope_check
      CHECK (scope IN ('user', 'workspace'));
  END IF;
END $$;

-- a workspace-scoped KB must carry a workspace_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_bases_workspace_scope_check'
  ) THEN
    ALTER TABLE public.knowledge_bases
      ADD CONSTRAINT knowledge_bases_workspace_scope_check
      CHECK (scope <> 'workspace' OR workspace_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS knowledge_bases_workspace_idx
  ON public.knowledge_bases (workspace_id)
  WHERE scope = 'workspace';

-- ============================================================================
-- 2. knowledge_bases: user-OR-workspace isolation (replaces 092 policy)
-- ============================================================================

DROP POLICY IF EXISTS knowledge_bases_user_isolation ON public.knowledge_bases;
CREATE POLICY knowledge_bases_user_isolation ON public.knowledge_bases
  AS PERMISSIVE FOR ALL TO public
  USING (
    (scope = 'user'
      AND app_current_user_id() IS NOT NULL
      AND user_id = app_current_user_id())
    OR
    (scope = 'workspace'
      AND app_current_workspace_id() IS NOT NULL
      AND workspace_id::text = app_current_workspace_id()::text)
  )
  WITH CHECK (
    (scope = 'user'
      AND app_current_user_id() IS NOT NULL
      AND user_id = app_current_user_id())
    OR
    (scope = 'workspace'
      AND app_current_workspace_id() IS NOT NULL
      AND workspace_id::text = app_current_workspace_id()::text)
  );

-- admin read (unchanged from 092; recreated idempotently)
DROP POLICY IF EXISTS knowledge_bases_admin_read ON public.knowledge_bases;
CREATE POLICY knowledge_bases_admin_read ON public.knowledge_bases
  AS PERMISSIVE FOR SELECT TO public
  USING (app_is_platform_admin());

-- ============================================================================
-- 3. Child tables: join-through-parent visibility
--    (own row by user_id, OR parent KB is workspace-scoped in my workspace)
--    WITH CHECK stays user_id = app_current_user_id() — you only write rows you
--    own; a member ingesting into a workspace KB still writes their own user_id.
-- ============================================================================

-- knowledge_documents
DROP POLICY IF EXISTS knowledge_documents_user_isolation ON public.knowledge_documents;
CREATE POLICY knowledge_documents_user_isolation ON public.knowledge_documents
  AS PERMISSIVE FOR ALL TO public
  USING (
    (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_bases kb
      WHERE kb.id = knowledge_documents.knowledge_base_id
        AND kb.scope = 'workspace'
        AND app_current_workspace_id() IS NOT NULL
        AND kb.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

-- knowledge_chunks
DROP POLICY IF EXISTS knowledge_chunks_user_isolation ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_user_isolation ON public.knowledge_chunks
  AS PERMISSIVE FOR ALL TO public
  USING (
    (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_bases kb
      WHERE kb.id = knowledge_chunks.knowledge_base_id
        AND kb.scope = 'workspace'
        AND app_current_workspace_id() IS NOT NULL
        AND kb.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

-- knowledge_embeddings
DROP POLICY IF EXISTS knowledge_embeddings_user_isolation ON public.knowledge_embeddings;
CREATE POLICY knowledge_embeddings_user_isolation ON public.knowledge_embeddings
  AS PERMISSIVE FOR ALL TO public
  USING (
    (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_bases kb
      WHERE kb.id = knowledge_embeddings.knowledge_base_id
        AND kb.scope = 'workspace'
        AND app_current_workspace_id() IS NOT NULL
        AND kb.workspace_id::text = app_current_workspace_id()::text
    )
  )
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed). Run as a single transaction:
-- ============================================================================
--
-- BEGIN;
--
-- -- Restore the user-only policies from migration 092.
-- DROP POLICY IF EXISTS knowledge_bases_user_isolation ON public.knowledge_bases;
-- CREATE POLICY knowledge_bases_user_isolation ON public.knowledge_bases
--   AS PERMISSIVE FOR ALL TO public
--   USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
--   WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());
--
-- DROP POLICY IF EXISTS knowledge_documents_user_isolation ON public.knowledge_documents;
-- CREATE POLICY knowledge_documents_user_isolation ON public.knowledge_documents
--   AS PERMISSIVE FOR ALL TO public
--   USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
--   WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());
--
-- DROP POLICY IF EXISTS knowledge_chunks_user_isolation ON public.knowledge_chunks;
-- CREATE POLICY knowledge_chunks_user_isolation ON public.knowledge_chunks
--   AS PERMISSIVE FOR ALL TO public
--   USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
--   WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());
--
-- DROP POLICY IF EXISTS knowledge_embeddings_user_isolation ON public.knowledge_embeddings;
-- CREATE POLICY knowledge_embeddings_user_isolation ON public.knowledge_embeddings
--   AS PERMISSIVE FOR ALL TO public
--   USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
--   WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());
--
-- DROP INDEX IF EXISTS knowledge_bases_workspace_idx;
-- ALTER TABLE public.knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_workspace_scope_check;
-- ALTER TABLE public.knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_scope_check;
-- ALTER TABLE public.knowledge_bases DROP COLUMN IF EXISTS scope;
-- ALTER TABLE public.knowledge_bases DROP COLUMN IF EXISTS workspace_id;
--
-- COMMIT;
