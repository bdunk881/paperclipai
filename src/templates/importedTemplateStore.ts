import { parseJsonColumn } from "../db/json";
import { inMemoryAllowed, isPostgresConfigured, queryPostgres } from "../db/postgres";
import { WorkflowTemplate } from "../types/workflow";

/**
 * Imported/user-created workflow templates (hybrid store: Postgres-backed with
 * an in-memory hot-path mirror).
 *
 * HEL-520: each cached/persisted template carries its owning `workspaceId` so
 * reads can be tenant-scoped. Visibility is NULL-tolerant (transitional):
 *   - `workspaceId === null`  → a legacy/global imported template (rows
 *     persisted before HEL-520 with workspace_id NULL); visible to EVERY
 *     workspace, and self-heals to a scoped row on its next save.
 *   - a non-null owner         → visible only to that workspace.
 *   - a read with no workspace arg (internal re-resolution of an already-owned
 *     run's DAG) sees everything — those paths operate on a run the caller
 *     already owns and are not a cross-tenant enumeration vector.
 */
interface CachedImportedTemplate {
  template: WorkflowTemplate;
  workspaceId: string | null;
}

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const importedTemplates = new Map<string, CachedImportedTemplate>();

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
  workspace_id?: string | null;
  template_definition?: WorkflowTemplate | string | null;
  dag?: WorkflowTemplate | string | null;
}

/** NULL-tolerant: is this cached entry visible to `workspaceId`? */
function isVisibleToWorkspace(
  entry: CachedImportedTemplate,
  workspaceId?: string | null,
): boolean {
  if (workspaceId === undefined || workspaceId === null) {
    return true;
  }
  if (entry.workspaceId === null) {
    return true;
  }
  return entry.workspaceId === workspaceId;
}

function hydrateImportedTemplate(
  template: WorkflowTemplate,
  workspaceId: string | null,
): WorkflowTemplate {
  importedTemplates.set(template.id, { template, workspaceId });
  return template;
}

function mapPersistedImportedTemplate(
  row: PersistedImportedTemplateRow
): WorkflowTemplate | undefined {
  const template = parseJsonColumn(row.dag ?? row.template_definition, null as WorkflowTemplate | null);
  if (!template) {
    return undefined;
  }

  return hydrateImportedTemplate(template, row.workspace_id ?? null);
}

async function persistImportedTemplate(
  template: WorkflowTemplate,
  importedBy?: string,
  workspaceId?: string | null,
): Promise<void> {
  if (!postgresPersistenceAvailable()) {
    return;
  }

  const wsId = workspaceId ?? null;

  // Dual ON CONFLICT target: workspace-scoped rows upsert against the partial
  // unique index on (workspace_id, external_template_id); global rows against
  // the workspace_id-NULL one (migration 023). The conflict WHERE predicate
  // must mirror the matching partial index exactly.
  const workflow = wsId
    ? await queryPostgres<{ id: string }>(
        `INSERT INTO workflows (workspace_id, external_template_id, name)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (workspace_id, external_template_id)
         WHERE workspace_id IS NOT NULL AND external_template_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, updated_at = now()
         RETURNING id`,
        [wsId, template.id, template.name]
      )
    : await queryPostgres<{ id: string }>(
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

/** Cache-only list, filtered to templates visible to `workspaceId`. */
export function listImportedTemplates(workspaceId?: string | null): WorkflowTemplate[] {
  return Array.from(importedTemplates.values())
    .filter((entry) => isVisibleToWorkspace(entry, workspaceId))
    .map((entry) => entry.template);
}

/** Shared scoped SELECT for the workspace's imported templates + globals. */
async function queryPersistedImportedTemplates(
  workspaceId: string | null,
  externalTemplateId?: string,
): Promise<WorkflowTemplate[]> {
  const result = await queryPostgres<PersistedImportedTemplateRow>(
    `SELECT w.external_template_id AS id, w.workspace_id, v.dag
       FROM workflows w
       JOIN workflow_versions v ON v.id = w.latest_version_id
      WHERE w.external_template_id IS NOT NULL
        AND ($1::uuid IS NULL OR w.workspace_id = $1::uuid OR w.workspace_id IS NULL)
        AND ($2::text IS NULL OR w.external_template_id = $2)
      ORDER BY v.created_at DESC`,
    [workspaceId, externalTemplateId ?? null]
  );
  return result.rows
    .map(mapPersistedImportedTemplate)
    .filter((template: WorkflowTemplate | undefined): template is WorkflowTemplate => Boolean(template));
}

/**
 * Postgres-backed list of imported templates visible to `workspaceId`. When
 * Postgres is configured the DB is authoritative (always queried, scoped), so
 * a fresh machine / another workspace sees the right set; otherwise the
 * in-memory cache is authoritative (dev/test).
 */
export async function listImportedTemplatesAsync(
  workspaceId?: string | null,
): Promise<WorkflowTemplate[]> {
  if (!postgresPersistenceAvailable()) {
    return listImportedTemplates(workspaceId);
  }
  return queryPersistedImportedTemplates(workspaceId ?? null);
}

/**
 * HEL-485: hydrate the in-memory imported-template cache from Postgres at boot.
 *
 * Without this, after a process/instance restart the cache is empty, so a run
 * started with an imported templateId would miss the hot path until the async
 * DB fallback re-loads it. Loads every workspace's templates (no scope filter)
 * so all machines share a warm cache. Best-effort + Postgres-gated; returns the
 * number of templates cached.
 */
export async function warmImportedTemplates(): Promise<number> {
  if (!postgresPersistenceAvailable()) {
    return 0;
  }
  const templates = await queryPersistedImportedTemplates(null);
  return templates.length;
}

/** Cache-only get, NULL-tolerant by workspace. Used by sync (display) paths. */
export function getImportedTemplate(
  id: string,
  workspaceId?: string | null,
): WorkflowTemplate | undefined {
  const entry = importedTemplates.get(id);
  if (!entry || !isVisibleToWorkspace(entry, workspaceId)) {
    return undefined;
  }
  return entry.template;
}

/**
 * Workspace-scoped get: cache hit (visible) on the hot path, else the DB
 * (scoped + NULL-tolerant) with cache hydration. Returns undefined when the id
 * doesn't resolve to a template this workspace may see.
 */
export async function getImportedTemplateAsync(
  id: string,
  workspaceId?: string | null,
): Promise<WorkflowTemplate | undefined> {
  const entry = importedTemplates.get(id);
  if (entry && isVisibleToWorkspace(entry, workspaceId)) {
    return entry.template;
  }
  if (!postgresPersistenceAvailable()) {
    return undefined;
  }
  const rows = await queryPersistedImportedTemplates(workspaceId ?? null, id);
  return rows[0];
}

export async function saveImportedTemplate(
  template: WorkflowTemplate,
  importedBy?: string,
  workspaceId?: string | null,
): Promise<void> {
  hydrateImportedTemplate(template, workspaceId ?? null);
  await persistImportedTemplate(template, importedBy, workspaceId ?? null);
}

export async function deleteImportedTemplate(
  id: string,
  workspaceId?: string | null,
): Promise<boolean> {
  const entry = importedTemplates.get(id);
  // Only drop from the cache when this workspace may see the row (NULL-tolerant).
  const hadInMemory =
    entry !== undefined && isVisibleToWorkspace(entry, workspaceId)
      ? importedTemplates.delete(id)
      : false;
  if (!postgresPersistenceAvailable()) {
    return hadInMemory;
  }
  // A workspace may delete its own imported template (or, transitionally, a
  // legacy global one); it can never delete another workspace's row.
  const result = await queryPostgres<{ id: string }>(
    `DELETE FROM workflows
       WHERE external_template_id = $1
         AND ($2::uuid IS NULL OR workspace_id = $2::uuid OR workspace_id IS NULL)
       RETURNING id`,
    [id, workspaceId ?? null],
  );
  return hadInMemory || (result.rowCount ?? 0) > 0;
}

export function resetImportedTemplatesForTests(): void {
  importedTemplates.clear();
}
