-- Migration 065: internal customer notes (admin-console support history).
--
-- A free-form per-user note surface visible only to platform admins. Markdown
-- body. Pinned notes float to the top of the Customer-360 panel.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  author_admin_id text NOT NULL,
  body text NOT NULL CHECK (length(body) > 0 AND length(body) <= 8000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_user_pinned_at
  ON customer_notes (user_id, pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_notes_admin_only ON customer_notes;
CREATE POLICY customer_notes_admin_only
  ON customer_notes
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

COMMIT;
