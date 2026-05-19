import { parseJsonColumn } from "../db/json";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "../db/postgres";
import { WorkflowTemplate } from "../types/workflow";

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const importedTemplates = new Map<string, WorkflowTemplate>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("importedTemplateStore requires DATABASE_URL outside development/test.");
}

interface PersistedImportedTemplateRow {
  id: string;
  template_definition?: WorkflowTemplate | string | null;
  dag?: WorkflowTemplate | string | null;
}

function hydrateImportedTemplate(template: WorkflowTemplate): WorkflowTemplate {
  importedTemplates.set(template.id, template);
  return template;
}

function mapPersistedImportedTemplate(
  row: PersistedImportedTemplateRow
): WorkflowTemplate | undefined {
  const template = parseJsonColumn(row.dag ?? row.template_definition, null as WorkflowTemplate | null);
  if (!template) {
    return undefined;
  }

  return hydrateImportedTemplate(template);
}

async function persistImportedTemplate(
  template: WorkflowTemplate,
  importedBy?: string
): Promise<void> {
  if (!postgresPersistenceAvailable()) {
    return;
  }

  const workflow = await queryPostgres<{ id: string }>(
    `INSERT INTO workflows (workspace_id, external_template_id, name)
     VALUES (NULL, $1, $2)
     ON CONFLICT (external_template_id)
     WHERE workspace_id IS NULL AND external_template_id IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [template.id, template.name]
  );
  const workflowId = workflow.rows[0]?.id;
  if (!workflowId) {
    throw new Error(`Failed to persist imported workflow ${template.id}`);
  }

  const existingVersion = await queryPostgres<{ id: string; version: number }>(
    `SELECT id, version
     FROM workflow_versions
     WHERE workflow_id = $1::uuid
       AND dag = $2::jsonb
     ORDER BY version DESC
     LIMIT 1`,
    [workflowId, JSON.stringify(template)]
  );

  let versionId = existingVersion.rows[0]?.id;
  if (!versionId) {
    const nextVersion = await queryPostgres<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM workflow_versions
       WHERE workflow_id = $1::uuid`,
      [workflowId]
    );
    const insertedVersion = await queryPostgres<{ id: string }>(
      `INSERT INTO workflow_versions (workflow_id, version, dag, created_by_user_id)
       VALUES ($1::uuid, $2, $3::jsonb, $4)
       RETURNING id`,
      [
        workflowId,
        Number(nextVersion.rows[0]?.next_version ?? 1),
        JSON.stringify(template),
        importedBy ?? null,
      ]
    );
    versionId = insertedVersion.rows[0]?.id;
  }

  if (!versionId) {
    throw new Error(`Failed to persist imported workflow version ${template.id}`);
  }

  await queryPostgres(
    "UPDATE workflows SET latest_version_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
    [workflowId, versionId]
  );
}
export function listImportedTemplates(): WorkflowTemplate[] {
  return Array.from(importedTemplates.values());
}

export async function listImportedTemplatesAsync(): Promise<WorkflowTemplate[]> {
  const localTemplates = listImportedTemplates();
  if (localTemplates.length > 0 || !postgresPersistenceAvailable()) {
    return localTemplates;
  }

  const result = await queryPostgres<PersistedImportedTemplateRow>(
    `SELECT w.external_template_id AS id, v.dag
     FROM workflows w
     JOIN workflow_versions v ON v.id = w.latest_version_id
     WHERE w.workspace_id IS NULL
       AND w.external_template_id IS NOT NULL
     ORDER BY v.created_at DESC`
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
  if (localTemplate || !postgresPersistenceAvailable()) {
    return localTemplate;
  }

  const result = await queryPostgres<PersistedImportedTemplateRow>(
    `SELECT w.external_template_id AS id, v.dag
     FROM workflows w
     JOIN workflow_versions v ON v.id = w.latest_version_id
     WHERE w.workspace_id IS NULL
       AND w.external_template_id = $1`,
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
