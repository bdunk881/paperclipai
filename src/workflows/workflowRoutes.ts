/**
 * Canonical workflow + workflow_version routes (HEL-27).
 *
 * The legacy workflow_templates persistence path stays in place — the dashboard's
 * WorkflowBuilder still calls /api/templates for save. This new surface lives
 * in parallel and lets the canonical engine (eventually) read durable
 * routines from `workflows` + `workflow_versions` (HEL-13 schema, migration
 * 023). The dashboard dual-writes on save so the canonical store fills up
 * with real customer DAGs as people use the builder.
 *
 * Routes:
 *   POST /api/workflows
 *     Create a workflow shell + v1 workflow_version with the given dag.
 *
 *   POST /api/workflows/:workflowId/versions
 *     Create a new immutable workflow_version for an existing workflow.
 *     Acceptance criterion "Versions are immutable; edits create a new
 *     version" maps to this — the dashboard calls this on every save to
 *     an existing workflow.
 *
 *   GET /api/workflows/:workflowId
 *     Single workflow lookup + its latest version's dag.
 *
 *   GET /api/workflows
 *     List workflows in the active workspace (newest first, limit 100).
 *
 * RLS-scoped via `withWorkspaceContext` — workspace_id is set on
 * workflows; workflow_versions inherit via FK to workflows.
 */

import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  deploymentStore,
  isDeploymentEnvironment,
  DEPLOYMENT_ENVIRONMENTS,
} from "../engine/deploymentStore";
import {
  createPresenceStore,
  colorForUser,
  type PresenceCursor,
  type PresenceState,
  type PresenceStore,
} from "./presenceStore";
import { parseJsonColumn } from "../db/json";
import type { WorkflowTemplate } from "../types/workflow";
import { parseFileDrop } from "./fileDrop";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

export interface WorkflowVersionResponse {
  id: string;
  version: number;
  dag: unknown;
  createdAt: string;
}

// List responses omit the DAG payload — scanning a workflows list shouldn't
// hydrate every routine's full graph. GET-by-id returns the full version.
export interface WorkflowVersionSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface WorkflowResponse {
  id: string;
  name: string;
  externalTemplateId: string | null;
  latestVersion: WorkflowVersionResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowListEntry {
  id: string;
  name: string;
  externalTemplateId: string | null;
  latestVersion: WorkflowVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_NAME_LENGTH ? trimmed.slice(0, MAX_NAME_LENGTH) : trimmed;
}

async function insertWorkflowVersion(
  client: PoolClient,
  workflowId: string,
  version: number,
  dag: unknown,
  createdByUserId: string,
): Promise<{ id: string; createdAt: string }> {
  const id = randomUUID();
  const result = await client.query<{ created_at: Date }>(
    `INSERT INTO workflow_versions (id, workflow_id, version, dag, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING created_at`,
    [id, workflowId, version, JSON.stringify(dag ?? {}), createdByUserId],
  );
  // Bump workflows.latest_version_id so GET /api/workflows/:id can return
  // the latest version with one query.
  await client.query(
    `UPDATE workflows SET latest_version_id = $1, updated_at = now() WHERE id = $2`,
    [id, workflowId],
  );
  return {
    id,
    createdAt:
      result.rows[0]?.created_at instanceof Date
        ? result.rows[0].created_at.toISOString()
        : String(result.rows[0]?.created_at),
  };
}

/**
 * HEL-241C — Shared in-process presence store. Single per-process
 * instance; rebuilt on cold start (presence is ephemeral by design).
 * Exported so tests can inject their own deterministic clock.
 */
export const defaultPresenceStore: PresenceStore = createPresenceStore();

export function createWorkflowRoutes(
  pool: Pool,
  /** Test seam — defaults to the process-wide presence store. */
  presenceStore: PresenceStore = defaultPresenceStore,
) {
  const router = Router();

  // ---------------------------------------------------------------------
  // POST /api/workflows — create a workflow + v1 version
  // ---------------------------------------------------------------------
  router.post("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const body = req.body as { name?: unknown; dag?: unknown; externalTemplateId?: unknown };
    const name = sanitizeName(body?.name);
    if (!name) {
      res.status(400).json({ error: "Workflow name is required" });
      return;
    }
    const dag = body?.dag ?? {};
    const externalTemplateId =
      typeof body?.externalTemplateId === "string" && body.externalTemplateId.trim()
        ? body.externalTemplateId.trim()
        : null;

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          await client.query("BEGIN");
          try {
            // HEL-792: idempotent on (workspace_id, external_template_id).
            // The imported-template save (POST /api/templates →
            // persistImportedTemplate) may already have created this
            // workflows row; a bare INSERT then violates
            // uq_workflows_workspace_external_template and 500s — which the
            // dashboard dual-write silently swallowed. Resolve-or-create:
            // upsert the shell, then RETURN the existing latest version
            // (don't append a redundant second version for the same logical
            // save) or write v1 for a genuinely new workflow.
            let workflowId: string;
            if (externalTemplateId) {
              const upsert = await client.query<{ id: string }>(
                `INSERT INTO workflows (id, workspace_id, name, external_template_id)
                   VALUES ($1, $2, $3, $4)
                 ON CONFLICT (workspace_id, external_template_id)
                   WHERE workspace_id IS NOT NULL AND external_template_id IS NOT NULL
                   DO UPDATE SET name = EXCLUDED.name, updated_at = now()
                 RETURNING id`,
                [randomUUID(), workspaceId, name, externalTemplateId],
              );
              workflowId = upsert.rows[0]!.id;
            } else {
              workflowId = randomUUID();
              await client.query(
                `INSERT INTO workflows (id, workspace_id, name, external_template_id)
                   VALUES ($1, $2, $3, NULL)`,
                [workflowId, workspaceId, name],
              );
            }

            // Reuse the existing latest version if the workflow already has
            // one (e.g. written by the imported-template save); appending here
            // would create a redundant second version for the same save.
            const existing = await client.query<{
              id: string;
              version: number;
              dag: unknown;
              created_at: Date | string;
            }>(
              `SELECT v.id, v.version, v.dag, v.created_at
                 FROM workflows w
                 JOIN workflow_versions v ON v.id = w.latest_version_id
                WHERE w.id = $1
                LIMIT 1`,
              [workflowId],
            );

            const existingRow = existing.rows[0];
            const latestVersion: WorkflowVersionResponse = existingRow
              ? {
                  id: existingRow.id,
                  version: existingRow.version,
                  dag: existingRow.dag ?? {},
                  createdAt:
                    existingRow.created_at instanceof Date
                      ? existingRow.created_at.toISOString()
                      : String(existingRow.created_at),
                }
              : await (async () => {
                  const v1 = await insertWorkflowVersion(client, workflowId, 1, dag, userId);
                  return { id: v1.id, version: 1, dag, createdAt: v1.createdAt };
                })();

            const meta = await client.query<{ created_at: Date | string; updated_at: Date | string }>(
              `SELECT created_at, updated_at FROM workflows WHERE id = $1 LIMIT 1`,
              [workflowId],
            );
            const metaRow = meta.rows[0];
            const createdAt =
              metaRow?.created_at instanceof Date
                ? metaRow.created_at.toISOString()
                : String(metaRow?.created_at ?? latestVersion.createdAt);
            const updatedAt =
              metaRow?.updated_at instanceof Date
                ? metaRow.updated_at.toISOString()
                : String(metaRow?.updated_at ?? latestVersion.createdAt);

            await client.query("COMMIT");
            return {
              id: workflowId,
              name,
              externalTemplateId,
              latestVersion,
              createdAt,
              updatedAt,
            } satisfies WorkflowResponse;
          } catch (err) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // preserve original error
            }
            throw err;
          }
        },
      );
      res.status(201).json(result);
    } catch (err) {
      console.error(`[workflows] create failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to create workflow" });
    }
  }));

  // ---------------------------------------------------------------------
  // POST /api/workflows/:workflowId/versions — create a new immutable
  // workflow_version. Acceptance: "Versions are immutable; edits create
  // a new version."
  // ---------------------------------------------------------------------
  router.post("/:workflowId/versions", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const workflowId = req.params.workflowId;
    if (!workflowId || !UUID_RE.test(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID format" });
      return;
    }

    const body = req.body as { dag?: unknown };
    const dag = body?.dag ?? {};

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          await client.query("BEGIN");
          try {
            // Confirm the workflow exists + belongs to this workspace.
            // RLS would also reject, but a clean 404 beats an opaque 500.
            const wf = await client.query<{ id: string }>(
              `SELECT id FROM workflows WHERE id = $1 LIMIT 1`,
              [workflowId],
            );
            if (wf.rows.length === 0) {
              throw new Error("__not_found");
            }
            // HEL-792: no-op dedup — if the immediate latest version already
            // holds this exact dag (a re-save with no changes), reuse it
            // instead of appending a redundant version. Scoped to the LATEST
            // only, so the restore flow (which re-POSTs an OLDER version's dag)
            // still creates a new version as intended.
            const noop = await client.query<{
              id: string;
              version: number;
              created_at: Date | string;
            }>(
              `SELECT v.id, v.version, v.created_at
                 FROM workflows w
                 JOIN workflow_versions v ON v.id = w.latest_version_id
                WHERE w.id = $1 AND v.dag = $2::jsonb
                LIMIT 1`,
              [workflowId, JSON.stringify(dag ?? {})],
            );
            const noopRow = noop.rows[0];
            if (noopRow) {
              await client.query("COMMIT");
              return {
                id: noopRow.id,
                version: noopRow.version,
                dag,
                createdAt:
                  noopRow.created_at instanceof Date
                    ? noopRow.created_at.toISOString()
                    : String(noopRow.created_at),
              } satisfies WorkflowVersionResponse;
            }

            // Compute the next version number atomically. The UNIQUE
            // (workflow_id, version) constraint serializes concurrent
            // appends — the loser retries on its next attempt.
            const max = await client.query<{ max_version: number | null }>(
              `SELECT MAX(version) AS max_version FROM workflow_versions WHERE workflow_id = $1`,
              [workflowId],
            );
            const nextVersion = (max.rows[0]?.max_version ?? 0) + 1;
            const inserted = await insertWorkflowVersion(
              client,
              workflowId,
              nextVersion,
              dag,
              userId,
            );
            await client.query("COMMIT");
            return {
              id: inserted.id,
              version: nextVersion,
              dag,
              createdAt: inserted.createdAt,
            } satisfies WorkflowVersionResponse;
          } catch (err) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // preserve original error
            }
            throw err;
          }
        },
      );
      res.status(201).json(result);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "__not_found") {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      console.error(`[workflows] new version failed: ${msg}`);
      res.status(500).json({ error: "Failed to create workflow version" });
    }
  }));

  // ---------------------------------------------------------------------
  // GET /api/workflows/:workflowId — single workflow lookup
  // ---------------------------------------------------------------------
  router.get("/:workflowId", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const workflowId = req.params.workflowId;
    if (!workflowId || !UUID_RE.test(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID format" });
      return;
    }

    interface JoinRow {
      id: string;
      name: string;
      external_template_id: string | null;
      latest_version_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
      v_id: string | null;
      v_version: number | null;
      v_dag: unknown;
      v_created_at: Date | string | null;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<JoinRow>(
            `SELECT w.id, w.name, w.external_template_id, w.latest_version_id,
                    w.created_at, w.updated_at,
                    v.id AS v_id, v.version AS v_version, v.dag AS v_dag,
                    v.created_at AS v_created_at
               FROM workflows w
               LEFT JOIN workflow_versions v ON v.id = w.latest_version_id
              WHERE w.id = $1
              LIMIT 1`,
            [workflowId],
          ),
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      const row = result.rows[0];
      res.json({
        id: row.id,
        name: row.name,
        externalTemplateId: row.external_template_id,
        latestVersion:
          row.v_id && row.v_version != null
            ? {
                id: row.v_id,
                version: row.v_version,
                dag: row.v_dag ?? {},
                createdAt:
                  row.v_created_at instanceof Date
                    ? row.v_created_at.toISOString()
                    : String(row.v_created_at),
              }
            : null,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        updatedAt:
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : String(row.updated_at),
      } satisfies WorkflowResponse);
    } catch (err) {
      console.error(`[workflows] get failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load workflow" });
    }
  }));

  // ---------------------------------------------------------------------
  // POST /api/workflows/:workflowId/file — file-drop start (HEL-680).
  // Upload a file to start a run of a file_trigger workflow; the content
  // lands in context.file for the file_trigger head to surface.
  // ---------------------------------------------------------------------
  router.post("/:workflowId/file", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }
    const workflowId = req.params.workflowId;
    if (!workflowId || !UUID_RE.test(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID format" });
      return;
    }
    const parsed = parseFileDrop(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const result = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) =>
      client.query<{ dag: unknown }>(
        `SELECT v.dag
           FROM workflows w
           JOIN workflow_versions v ON v.id = w.latest_version_id
          WHERE w.id = $1
          LIMIT 1`,
        [workflowId],
      ),
    );
    const row = result.rows[0];
    const template = row ? parseJsonColumn<WorkflowTemplate | null>(row.dag, null) : null;
    if (!template || !Array.isArray(template.steps) || template.steps.length === 0) {
      res.status(404).json({ error: "Workflow not found or has no runnable version" });
      return;
    }
    if (!template.steps.some((step) => step.kind === "file_trigger")) {
      res.status(400).json({ error: "Workflow has no file_trigger step to receive the file" });
      return;
    }

    // Lazy-import the engine so this route module doesn't pull the engine's
    // ESM-only transitive deps (@mistralai) at load time — keeps
    // workflowRoutes.test.ts loadable without mocking ./llmProviders.
    const { workflowEngine } = await import("../engine/WorkflowEngine");
    const run = await workflowEngine.startRun(
      template,
      { workspaceId, file: parsed.file },
      { workspaceId },
      userId,
    );
    res.status(202).json({ runId: run.id });
  }));

  // ---------------------------------------------------------------------
  // GET /api/workflows/:workflowId/versions/:versionId — single version
  // with the full dag. Powers the v2 Studio Versions panel diff modal
  // and the restore flow (which fetches an older version's dag, then
  // POSTs it back as a new version).
  // ---------------------------------------------------------------------
  router.get(
    "/:workflowId/versions/:versionId",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const { workflowId, versionId } = req.params;
      if (!workflowId || !UUID_RE.test(workflowId)) {
        res.status(400).json({ error: "Invalid workflow ID format" });
        return;
      }
      if (!versionId || !UUID_RE.test(versionId)) {
        res.status(400).json({ error: "Invalid version ID format" });
        return;
      }

      interface SingleVersionRow {
        id: string;
        version: number;
        dag: unknown;
        created_at: Date | string;
        is_latest: boolean;
      }

      try {
        const result = await withWorkspaceContext(
          pool,
          { workspaceId, userId },
          async (client) =>
            client.query<SingleVersionRow>(
              `SELECT v.id, v.version, v.dag, v.created_at,
                      (v.id = w.latest_version_id) AS is_latest
                 FROM workflow_versions v
                 JOIN workflows w ON w.id = v.workflow_id
                WHERE v.id = $1
                  AND v.workflow_id = $2
                  AND w.workspace_id = $3
                LIMIT 1`,
              [versionId, workflowId, workspaceId],
            ),
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Workflow version not found" });
          return;
        }
        const row = result.rows[0]!;
        res.json({
          id: row.id,
          version: row.version,
          dag: row.dag ?? {},
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
          isLatest: row.is_latest,
        });
      } catch (err) {
        console.error(
          `[workflows] version fetch failed: ${(err as Error).message}`,
        );
        res.status(500).json({ error: "Failed to load workflow version" });
      }
    }),
  );

  // ---------------------------------------------------------------------
  // GET /api/workflows/:workflowId/versions — list immutable versions
  // newest first (LIMIT 50). Powers the v2 Studio Versions panel.
  // ---------------------------------------------------------------------
  router.get("/:workflowId/versions", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const workflowId = req.params.workflowId;
    if (!workflowId || !UUID_RE.test(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID format" });
      return;
    }

    interface VersionRow {
      id: string;
      version: number;
      created_at: Date | string;
      is_latest: boolean;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<VersionRow>(
            `SELECT v.id, v.version, v.created_at,
                    (v.id = w.latest_version_id) AS is_latest
               FROM workflow_versions v
               JOIN workflows w ON w.id = v.workflow_id
              WHERE v.workflow_id = $1
                AND w.workspace_id = $2
              ORDER BY v.version DESC
              LIMIT 50`,
            [workflowId, workspaceId],
          ),
      );
      res.json({
        workflowId,
        versions: result.rows.map((row) => ({
          id: row.id,
          version: row.version,
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
          isLatest: row.is_latest,
        })),
      });
    } catch (err) {
      console.error(`[workflows] versions list failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to list workflow versions" });
    }
  }));

  // ---------------------------------------------------------------------
  // Environments (HEL-820): deploy / rollback a version to an environment,
  // list deployment history, and atomic version restore.
  // ---------------------------------------------------------------------

  // Resolve a version's number iff it belongs to this workflow + workspace.
  async function resolveWorkspaceVersion(
    workflowId: string,
    versionId: string,
    workspaceId: string,
    userId: string,
  ): Promise<number | null> {
    return withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
      const r = await client.query<{ version: number }>(
        `SELECT v.version
           FROM workflow_versions v
           JOIN workflows w ON w.id = v.workflow_id
          WHERE v.id = $1 AND v.workflow_id = $2 AND w.workspace_id = $3
          LIMIT 1`,
        [versionId, workflowId, workspaceId],
      );
      return r.rows[0]?.version ?? null;
    });
  }

  // Shared deploy/rollback handler (rollback = deploy of an older version + a
  // default note). deploymentStore writes via the BYPASSRLS pool; the explicit
  // workspace_id + the version-ownership check above are the tenancy guards.
  const deployHandler = (isRollback: boolean) =>
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }
      const workflowId = req.params.workflowId;
      if (!workflowId || !UUID_RE.test(workflowId)) {
        res.status(400).json({ error: "Invalid workflow ID format" });
        return;
      }
      const body = req.body as { environment?: unknown; versionId?: unknown; note?: unknown };
      const environment = body?.environment;
      if (!isDeploymentEnvironment(environment)) {
        res.status(400).json({ error: "environment must be one of dev, staging, prod" });
        return;
      }
      const versionId = typeof body?.versionId === "string" ? body.versionId : "";
      if (!UUID_RE.test(versionId)) {
        res.status(400).json({ error: "Invalid versionId format" });
        return;
      }
      try {
        const version = await resolveWorkspaceVersion(workflowId, versionId, workspaceId, userId);
        if (version === null) {
          res.status(404).json({ error: "Workflow version not found" });
          return;
        }
        const note =
          typeof body?.note === "string" && body.note.trim()
            ? body.note.trim()
            : isRollback
              ? `Rolled back to v${version}`
              : null;
        const deployment = await deploymentStore.deployVersion({
          workflowId,
          workspaceId,
          environment,
          versionId,
          version,
          note,
          userId,
        });
        res.status(201).json(deployment);
      } catch (err) {
        console.error(`[workflows] deploy failed: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to deploy workflow version" });
      }
    });

  router.post("/:workflowId/deployments", deployHandler(false));
  router.post("/:workflowId/deployments/rollback", deployHandler(true));

  // GET /api/workflows/:id/deployments[?environment=] — history + current-per-env.
  router.get("/:workflowId/deployments", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }
    const workflowId = req.params.workflowId;
    if (!workflowId || !UUID_RE.test(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID format" });
      return;
    }
    const environment = isDeploymentEnvironment(req.query.environment)
      ? req.query.environment
      : undefined;
    try {
      const ownsWorkflow = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const r = await client.query(
            `SELECT 1 FROM workflows WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
            [workflowId, workspaceId],
          );
          return r.rows.length > 0;
        },
      );
      if (!ownsWorkflow) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      const deployments = await deploymentStore.listDeployments(workflowId, environment);
      const current: Record<string, unknown> = {};
      for (const env of DEPLOYMENT_ENVIRONMENTS) {
        current[env] = (await deploymentStore.getCurrentDeployment(workflowId, env)) ?? null;
      }
      res.json({ workflowId, deployments, current });
    } catch (err) {
      console.error(`[workflows] deployments list failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to list deployments" });
    }
  }));

  // POST /api/workflows/:id/versions/:versionId/restore — atomic history-restore:
  // append a NEW latest version holding the old version's dag (server-side, one
  // step), replacing the old 2-step client fetch+re-POST flow.
  router.post(
    "/:workflowId/versions/:versionId/restore",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }
      const { workflowId, versionId } = req.params;
      if (!workflowId || !UUID_RE.test(workflowId) || !versionId || !UUID_RE.test(versionId)) {
        res.status(400).json({ error: "Invalid workflow or version ID format" });
        return;
      }
      try {
        const result = await withWorkspaceContext(
          pool,
          { workspaceId, userId },
          async (client) => {
            await client.query("BEGIN");
            try {
              const old = await client.query<{ dag: unknown; version: number }>(
                `SELECT v.dag, v.version
                   FROM workflow_versions v
                   JOIN workflows w ON w.id = v.workflow_id
                  WHERE v.id = $1 AND v.workflow_id = $2 AND w.workspace_id = $3
                  LIMIT 1`,
                [versionId, workflowId, workspaceId],
              );
              if (old.rows.length === 0) {
                throw new Error("__not_found");
              }
              const oldDag = old.rows[0]!.dag ?? {};
              const max = await client.query<{ max_version: number | null }>(
                `SELECT MAX(version) AS max_version FROM workflow_versions WHERE workflow_id = $1`,
                [workflowId],
              );
              const nextVersion = (max.rows[0]?.max_version ?? 0) + 1;
              const inserted = await insertWorkflowVersion(
                client,
                workflowId,
                nextVersion,
                oldDag,
                userId,
              );
              await client.query("COMMIT");
              return {
                id: inserted.id,
                version: nextVersion,
                dag: oldDag,
                createdAt: inserted.createdAt,
                restoredFromVersion: old.rows[0]!.version,
              };
            } catch (err) {
              try {
                await client.query("ROLLBACK");
              } catch {
                // preserve original error
              }
              throw err;
            }
          },
        );
        res.status(201).json(result);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "__not_found") {
          res.status(404).json({ error: "Workflow version not found" });
          return;
        }
        console.error(`[workflows] restore failed: ${msg}`);
        res.status(500).json({ error: "Failed to restore workflow version" });
      }
    }),
  );

  // ---------------------------------------------------------------------
  // GET /api/workflows — list newest first (LIMIT 100). Optional
  // ?externalTemplateId=X filter lets the dashboard resolve the
  // canonical workflow_id for a loaded legacy template ID so the
  // Versions panel can surface for templates that haven't been
  // re-saved since canonicalization.
  // ---------------------------------------------------------------------
  router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const externalTemplateId =
      typeof req.query.externalTemplateId === "string" &&
      req.query.externalTemplateId.trim().length > 0
        ? req.query.externalTemplateId.trim().slice(0, MAX_NAME_LENGTH)
        : null;

    interface ListRow {
      id: string;
      name: string;
      external_template_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
      v_id: string | null;
      v_version: number | null;
      v_created_at: Date | string | null;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<ListRow>(
            `SELECT w.id, w.name, w.external_template_id,
                    w.created_at, w.updated_at,
                    v.id AS v_id, v.version AS v_version,
                    v.created_at AS v_created_at
               FROM workflows w
               LEFT JOIN workflow_versions v ON v.id = w.latest_version_id
              WHERE w.workspace_id = $1
                AND ($2::text IS NULL OR w.external_template_id = $2)
              ORDER BY w.updated_at DESC, w.id DESC
              LIMIT 100`,
            [workspaceId, externalTemplateId],
          ),
      );
      res.json({
        workflows: result.rows.map((row): WorkflowListEntry => ({
          id: row.id,
          name: row.name,
          externalTemplateId: row.external_template_id,
          latestVersion:
            row.v_id && row.v_version != null
              ? {
                  id: row.v_id,
                  version: row.v_version,
                  createdAt:
                    row.v_created_at instanceof Date
                      ? row.v_created_at.toISOString()
                      : String(row.v_created_at),
                }
              : null,
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
          updatedAt:
            row.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : String(row.updated_at),
        })),
      });
    } catch (err) {
      console.error(`[workflows] list failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to list workflows" });
    }
  }));

  // ---------------------------------------------------------------------
  // HEL-241C — Workflow presence (collaborative awareness)
  // ---------------------------------------------------------------------
  // POST /api/workflows/:workflowId/presence — heartbeat + snapshot.
  //
  // Combines write + read in a single round-trip: the client posts its
  // own state and gets back the live peer list. Poll every 5s while
  // the Studio is open. Stale entries (no heartbeat in 30s) are
  // reaped automatically on each read — no explicit "leave" call
  // needed when the user closes the tab.
  //
  // Body shape:
  //   { selectedStepId?: string | null, name?: string }
  //
  // Response:
  //   { peers: PresenceState[] }   (excludes the caller)
  //
  // Auth: same workspace gating as the rest of /api/workflows.
  // ---------------------------------------------------------------------
  router.post(
    "/:workflowId/presence",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }
      const { workflowId } = req.params;
      if (!UUID_RE.test(workflowId)) {
        res.status(400).json({ error: "workflowId must be a uuid" });
        return;
      }
      const body = (req.body ?? {}) as {
        selectedStepId?: string | null;
        name?: string;
        cursor?: { x?: unknown; y?: unknown } | null;
      };
      const trimmedName =
        typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      presenceStore.upsert(workflowId, {
        userId,
        name: trimmedName || "Teammate",
        color: colorForUser(userId),
        selectedStepId:
          typeof body.selectedStepId === "string" ? body.selectedStepId : null,
        cursor: parseCursor(body.cursor),
        lastSeen: Date.now(),
      });
      res.json({ peers: presenceStore.peers(workflowId, userId) });
    }),
  );

  // ---------------------------------------------------------------------
  // HEL-241C v2 — GET /api/workflows/:workflowId/presence/stream
  //
  // SSE channel for live presence (cursors + selection). Sends an
  // initial snapshot, then a fresh peer list on every upsert/remove.
  // Falls back to polling on the client when SSE is unavailable
  // (corporate proxies, browsers that throttle background EventSource
  // connections, etc.) — see useWorkflowPresence in the dashboard.
  //
  // Auth: EventSource can't set headers, so the client passes the
  // bearer token via ?access_token=… (same shim used by every other
  // SSE endpoint — see app.ts SSE-token middleware).
  // ---------------------------------------------------------------------
  router.get(
    "/:workflowId/presence/stream",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }
      const { workflowId } = req.params;
      if (!UUID_RE.test(workflowId)) {
        res.status(400).json({ error: "workflowId must be a uuid" });
        return;
      }

      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable nginx response buffering — without this proxies hold
        // SSE chunks until they accumulate ~4KB, which kills the live
        // feel for low-rate channels like presence.
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      const send = (event: string, payload: unknown): void => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      const broadcast = (peers: PresenceState[]): void => {
        send("presence", {
          peers: peers.filter((p) => p.userId !== userId),
        });
      };

      // Initial snapshot — without it, a client that connects mid-session
      // would see nothing until the next peer change.
      broadcast(presenceStore.peers(workflowId));

      const unsubscribe = presenceStore.subscribe(workflowId, broadcast);
      const heartbeat = setInterval(() => {
        // Comment lines keep idle connections alive through proxies that
        // close after ~30s of silence. Comments are valid SSE and the
        // EventSource client ignores them.
        res.write(`: keep-alive ${Date.now()}\n\n`);
      }, 15_000);

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }),
  );

  return router;
}

function parseCursor(raw: unknown): PresenceCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
