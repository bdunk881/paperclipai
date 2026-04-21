BEGIN;

CREATE TABLE IF NOT EXISTS workflow_imported_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  version text NOT NULL,
  template_definition jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by text
);

CREATE INDEX IF NOT EXISTS idx_workflow_imported_templates_imported_at
  ON workflow_imported_templates (imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_imported_templates_category
  ON workflow_imported_templates (category);

COMMIT;
