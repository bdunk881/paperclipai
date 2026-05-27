/**
 * Customer-360 search + lookup routes.
 *
 * Mounted under /api/admin-console/lookup. All routes assume requirePlatformAdmin
 * has run upstream (so req.platformAdminDb is in scope and the session GUC
 * `app.is_platform_admin` is set).
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createLookupRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /search?q=<email|user_id|workspace_id>
  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) return res.status(400).json({ error: "q required" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const admin = r.platformAdmin.userId;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "lookup_user",
        reason: "",
        payload: { query: q },
        context: extractAuditContext(req),
      });

      // Email → admin_lookup_user_by_email
      if (EMAIL_RE.test(q)) {
        const result = await client.query(
          "SELECT * FROM admin_lookup_user_by_email($1)",
          [q],
        );
        return res.json({ kind: "user", results: result.rows });
      }

      // UUID → could be user id (text uuid) or workspace id
      if (UUID_RE.test(q)) {
        const [userResult, workspaceResult] = await Promise.all([
          client.query("SELECT * FROM admin_lookup_user_by_id($1)", [q]),
          client.query(
            "SELECT id AS workspace_id, name, owner_user_id, status, created_at FROM workspaces WHERE id = $1",
            [q],
          ),
        ]);
        return res.json({
          kind: "id",
          user: userResult.rows[0] ?? null,
          workspace: workspaceResult.rows[0] ?? null,
        });
      }

      return res.status(400).json({ error: "q must be an email or uuid" });
    }),
  );

  // GET /user/:userId — full Customer-360 bundle.
  router.get(
    "/user/:userId",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const admin = r.platformAdmin.userId;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "view_user",
        targetUserId: userId,
        reason: "",
        context: extractAuditContext(req),
      });

      const [user, workspaces, notes] = await Promise.all([
        client.query("SELECT * FROM admin_lookup_user_by_id($1)", [userId]),
        client.query("SELECT * FROM admin_list_workspaces_for_user($1)", [userId]),
        client.query(
          `SELECT id, body, pinned, author_admin_id, created_at, updated_at
             FROM customer_notes
            WHERE user_id = $1 AND deleted_at IS NULL
            ORDER BY pinned DESC, created_at DESC
            LIMIT 50`,
          [userId],
        ),
      ]);

      if (user.rows.length === 0) return res.status(404).json({ error: "user not found" });

      return res.json({
        user: user.rows[0],
        workspaces: workspaces.rows,
        notes: notes.rows,
      });
    }),
  );

  // GET /user/:userId/activity?limit=
  router.get(
    "/user/:userId/activity",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const limit = Number.parseInt(String(req.query.limit ?? "100"), 10) || 100;

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const admin = r.platformAdmin.userId;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "view_activity",
        targetUserId: userId,
        payload: { limit },
        context: extractAuditContext(req),
      });

      const result = await client.query(
        "SELECT * FROM admin_recent_activity_for_user($1, $2)",
        [userId, limit],
      );
      return res.json({ events: result.rows });
    }),
  );

  return router;
}
