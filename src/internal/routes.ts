/**
 * Internal API routes — reachable only by the Cloudflare Worker
 * (cf-worker/) via the requireCfWorker middleware, NOT by end users.
 *
 * Mount target: app.use("/api/internal", requireCfWorker, createInternalRoutes(pool))
 *
 * The Worker already verified the end-user's token + workspace membership at
 * the edge (HEL-801 / B4) before calling these; the routes still re-check the
 * role + workflow-existence under RLS context as defense in depth, and take
 * {workspaceId, userId} from the (Worker-authenticated) request payload.
 */
import express from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { type CfWorkerRequest } from "../middleware/requireCfWorker";
import { resolveWorkspaceRole, type WorkspaceRole } from "../middleware/workspaceResolver";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { createYDocSnapshotStore } from "../workflows/ydoc/ydocSnapshotStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same allowlist the WS upgrade gate uses (attachYDocUpgradeHandler).
const ALLOWED_ROLES: ReadonlySet<WorkspaceRole> = new Set(["owner", "admin", "developer"]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function createInternalRoutes(getPool: () => Pool): express.Router {
  const router = express.Router();
  // Resolve the pool + snapshot store LAZILY (on the first DB-backed request),
  // never at mount time: app.ts builds the whole router tree on import, and
  // getPostgresPool() throws when DATABASE_URL is unset (Jest / in-memory mode).
  // The /__health route below stays pool-free so the worker-JWT smoke target
  // works in every mode.
  let cachedStore: ReturnType<typeof createYDocSnapshotStore> | null = null;
  const snapshotStore = (): ReturnType<typeof createYDocSnapshotStore> =>
    (cachedStore ??= createYDocSnapshotStore(getPool()));

  // HEL-310: smoke target for the worker→server JWT path.
  router.get("/__health", (req, res) => {
    const claims = (req as CfWorkerRequest).cfWorker;
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      cfWorker: claims ? { sub: claims.sub, iss: claims.iss, aud: claims.aud } : null,
    });
  });

  // HEL-799 (B2): authorize a {userId, workspaceId} pair for a workflow's Yjs
  // doc. Mirrors attachYDocUpgradeHandler's gate verbatim — role allowlist +
  // workflow-exists-in-workspace under RLS — so the WorkflowDocDO edge gate
  // (B4) gets the same verdict the in-process room would. The B4 edge already
  // verified the user's Supabase token; this is the workspace-authorization
  // half (and defense in depth).
  router.post(
    "/ydoc/authorize",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        workflowId?: unknown;
        workspaceId?: unknown;
        userId?: unknown;
      };
      if (!isUuid(body.workflowId) || !isUuid(body.workspaceId) || typeof body.userId !== "string" || !body.userId.trim()) {
        res.status(400).json({ error: "workflowId, workspaceId, userId are required" });
        return;
      }
      const workflowId = body.workflowId;
      const workspaceId = body.workspaceId;
      const userId = body.userId;

      const pool = getPool();
      const role = await resolveWorkspaceRole(pool, workspaceId, userId);
      if (!role || !ALLOWED_ROLES.has(role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // Cross-workspace guard: the workflow must exist IN THIS workspace under
      // RLS context (a spoofed workflowId from another tenant lands here).
      const exists = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT id FROM workflows WHERE id = $1 LIMIT 1`,
          [workflowId],
        );
        return result.rows.length > 0;
      });
      if (!exists) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }

      res.json({ ok: true, role });
    }),
  );

  // HEL-799 (B2): persist the WorkflowDocDO's Y.Doc snapshot. Binary
  // (encodeStateAsUpdate) bytes travel base64 over JSON. Reuses
  // ydocSnapshotStore.save unchanged (single-row UPSERT, version+1) under RLS.
  router.post(
    "/workflows/:workflowId/ydoc-snapshot",
    asyncHandler(async (req, res) => {
      const workflowId = req.params.workflowId;
      const body = (req.body ?? {}) as {
        workspaceId?: unknown;
        userId?: unknown;
        state?: unknown;
      };
      if (
        !isUuid(workflowId) ||
        !isUuid(body.workspaceId) ||
        typeof body.userId !== "string" ||
        !body.userId.trim() ||
        typeof body.state !== "string"
      ) {
        res.status(400).json({ error: "workspaceId, userId, state (base64) are required" });
        return;
      }
      const bytes = Buffer.from(body.state, "base64");
      await snapshotStore().save(workflowId, body.workspaceId, body.userId, new Uint8Array(bytes));
      res.status(204).end();
    }),
  );

  // HEL-799 (B2): load a workflow's latest Y.Doc snapshot (for DO cold-start
  // hydration, B5). state is base64-encoded; 404 when there's no snapshot yet.
  router.get(
    "/workflows/:workflowId/ydoc-snapshot",
    asyncHandler(async (req, res) => {
      const workflowId = req.params.workflowId;
      const { workspaceId, userId } = req.query;
      if (
        !isUuid(workflowId) ||
        !isUuid(workspaceId) ||
        typeof userId !== "string" ||
        !userId.trim()
      ) {
        res.status(400).json({ error: "workspaceId + userId query params are required" });
        return;
      }
      const snapshot = await snapshotStore().load(workflowId, workspaceId, userId);
      if (!snapshot) {
        res.status(404).json({ error: "No snapshot for this workflow" });
        return;
      }
      res.json({
        state: Buffer.from(snapshot.state).toString("base64"),
        version: snapshot.version,
      });
    }),
  );

  return router;
}
