/**
 * Sub-workflow template loader (HEL-673, Phase 1).
 *
 * Resolves a *saved* workflow to its latest-version DAG so a `sub_workflow`
 * step can run it as a child. Pool-backed exactly like `runStore` /
 * `scheduledWorkflowRun` — it grabs `getPostgresPool()` lazily, so it works in
 * whichever process executes a run (the app's inline `startRun` path and the
 * BullMQ worker) with no boot wiring. Tests `jest.mock` this module (the engine
 * already mocks sibling modules like `./llmProviders`), so the engine's
 * sub-workflow logic is unit-tested without a database.
 *
 * Tenancy: the DAG is loaded scoped to the caller's workspace even though the
 * worker is sessionless — mirrors the scheduled-DAG dispatcher.
 */

import type { WorkflowTemplate } from "../types/workflow";
import { parseJsonColumn } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";

interface WorkflowDagRow {
  dag: unknown;
  external_template_id: string | null;
  workflow_name: string | null;
}

/**
 * Latest runnable DAG for a saved workflow, scoped to `workspaceId`, or `null`
 * when there is no such workflow / no runnable latest version (the honest
 * "nothing to run" outcome — the caller turns it into a step failure).
 */
export async function loadLatestWorkflowTemplate(params: {
  workspaceId: string;
  workflowId: string;
}): Promise<WorkflowTemplate | null> {
  if (!isPostgresPersistenceEnabled()) {
    // No database (unit tests mock this module). Nothing to load.
    return null;
  }

  const pool = getPostgresPool();
  const result = await pool.query<WorkflowDagRow>(
    `SELECT v.dag, w.external_template_id, w.name AS workflow_name
       FROM workflows w
       JOIN workflow_versions v ON v.id = w.latest_version_id
      WHERE w.id = $1::uuid AND w.workspace_id = $2::uuid`,
    [params.workflowId, params.workspaceId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const template = parseJsonColumn<WorkflowTemplate | null>(row.dag, null);
  if (!template || !Array.isArray(template.steps) || template.steps.length === 0) {
    return null;
  }

  // The DAG JSON is client-authored, so id/name aren't guaranteed. Prefer the
  // workflow's real external_template_id (stable across versions), then the DAG
  // id, then the workflow UUID — never empty.
  const id =
    (typeof row.external_template_id === "string" && row.external_template_id) ||
    (typeof template.id === "string" && template.id) ||
    params.workflowId;
  const name =
    (typeof template.name === "string" && template.name) ||
    (typeof row.workflow_name === "string" && row.workflow_name) ||
    "Sub-workflow";

  return { ...template, id, name };
}
