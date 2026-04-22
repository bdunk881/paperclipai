import { parseJsonColumn } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { WorkflowTemplate } from "../types/workflow";

const importedTemplates = new Map<string, WorkflowTemplate>();

interface PersistedImportedTemplateRow {
  id: string;
  template_definition: WorkflowTemplate | string | null;
}

function hydrateImportedTemplate(template: WorkflowTemplate): WorkflowTemplate {
  importedTemplates.set(template.id, template);
  return template;
}

function mapPersistedImportedTemplate(
  row: PersistedImportedTemplateRow
): WorkflowTemplate | undefined {
  const template = parseJsonColumn(row.template_definition, null as WorkflowTemplate | null);
  if (!template) {
    return undefined;
  }

  return hydrateImportedTemplate(template);
}

async function persistImportedTemplate(
  template: WorkflowTemplate,
  importedBy?: string
): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  await queryPostgres(
    `INSERT INTO workflow_imported_templates (
      id,
      name,
      category,
      version,
      template_definition,
      imported_by
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      version = EXCLUDED.version,
      template_definition = EXCLUDED.template_definition,
      imported_by = EXCLUDED.imported_by,
      imported_at = now()`,
    [
      template.id,
      template.name,
      template.category,
      template.version,
      JSON.stringify(template),
      importedBy ?? null,
    ]
  );
}
export function listImportedTemplates(): WorkflowTemplate[] {
  return Array.from(importedTemplates.values());
}

export async function listImportedTemplatesAsync(): Promise<WorkflowTemplate[]> {
  const localTemplates = listImportedTemplates();
  if (localTemplates.length > 0 || !isPostgresConfigured()) {
    return localTemplates;
  }

  const result = await queryPostgres<PersistedImportedTemplateRow>(
    "SELECT id, template_definition FROM workflow_imported_templates ORDER BY imported_at DESC"
  );

  return result.rows
    .map(mapPersistedImportedTemplate)
    .filter((template: WorkflowTemplate | undefined): template is WorkflowTemplate => Boolean(template));
}
export function getImportedTemplate(id: string): WorkflowTemplate | undefined {
  return importedTemplates.get(id);
}

export async function getImportedTemplateAsync(
  id: string
): Promise<WorkflowTemplate | undefined> {
  const localTemplate = importedTemplates.get(id);
  if (localTemplate || !isPostgresConfigured()) {
    return localTemplate;
  }

  const result = await queryPostgres<PersistedImportedTemplateRow>(
    "SELECT id, template_definition FROM workflow_imported_templates WHERE id = $1",
    [id]
  );
  const row = result.rows[0];
  return row ? mapPersistedImportedTemplate(row) : undefined;
}

export async function saveImportedTemplate(
  template: WorkflowTemplate,
  importedBy?: string
): Promise<void> {
  hydrateImportedTemplate(template);
  await persistImportedTemplate(template, importedBy);
}

export function resetImportedTemplatesForTests(): void {
  importedTemplates.clear();
}
