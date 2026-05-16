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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

export interface WorkflowVersionResponse {
  id: string;
  version: number;
  dag: unknown;
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

export function createWorkflowRoutes(pool: Pool) {
  const router = Router();

  // ---------------------------------------------------------------------
  // POST /api/workflows — create a workflow + v1 version
  // ---------------------------------------------------------------------
  router.post("/", async (req: AuthenticatedRequest, res) => {
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
            const workflowId = randomUUID();
            await client.query(
              `INSERT INTO workflows (id, workspace_id, name, external_template_id)
                 VALUES ($1, $2, $3, $4)`,
              [workflowId, workspaceId, name, externalTemplateId],
            );
            const v1 = await insertWorkflowVersion(client, workflowId, 1, dag, userId);
            await client.query("COMMIT");
            return {
              id: workflowId,
              name,
              externalTemplateId,
              latestVersion: {
                id: v1.id,
                version: 1,
                dag,
                createdAt: v1.createdAt,
              },
              createdAt: v1.createdAt,
              updatedAt: v1.createdAt,
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
  });

  // ---------------------------------------------------------------------
  // POST /api/workflows/:workflowId/versions — create a new immutable
  // workflow_version. Acceptance: "Versions are immutable; edits create
  // a new version."
  // ---------------------------------------------------------------------
  router.post("/:workflowId/versions", async (req: AuthenticatedRequest, res) => {
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
  });

  // ---------------------------------------------------------------------
  // GET /api/workflows/:workflowId — single workflow lookup
  // ---------------------------------------------------------------------
  router.get("/:workflowId", async (req: AuthenticatedRequest, res) => {
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
  });

  // ---------------------------------------------------------------------
  // GET /api/workflows/:workflowId/versions — list immutable versions
  // newest first (LIMIT 50). Powers the v2 Studio Versions panel.
  // ---------------------------------------------------------------------
  router.get("/:workflowId/versions", async (req: AuthenticatedRequest, res) => {
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
  });

  // ---------------------------------------------------------------------
  // GET /api/workflows — list newest first (LIMIT 100)
  // ---------------------------------------------------------------------
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    interface ListRow {
      id: string;
      name: string;
      external_template_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<ListRow>(
            `SELECT id, name, external_template_id, created_at, updated_at
               FROM workflows
              WHERE workspace_id = $1
              ORDER BY updated_at DESC, id DESC
              LIMIT 100`,
            [workspaceId],
          ),
      );
      res.json({
        workflows: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          externalTemplateId: row.external_template_id,
          latestVersion: null,
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
  });

  return router;
}
