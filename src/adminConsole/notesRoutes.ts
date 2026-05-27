/**
 * Internal customer notes. Mounted under /api/admin-console/notes.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNotesRoutes(_pool: Pool): Router {
  const router = Router();

  // POST /  — { user_id, body, pinned? }
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const userId = String(req.body?.user_id ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      const pinned = req.body?.pinned === true;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      if (!body || body.length > 8000) return res.status(400).json({ error: "body 1..8000 chars" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const insert = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO customer_notes (user_id, author_admin_id, body, pinned)
              VALUES ($1, $2, $3, $4)
           RETURNING id, created_at`,
        [userId, admin, body, pinned],
      );

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "create_note",
        targetUserId: userId,
        payload: { note_id: insert.rows[0].id, pinned },
        context: extractAuditContext(req),
      });

      return res.status(201).json({
        id: insert.rows[0].id,
        created_at: insert.rows[0].created_at,
        author_admin_id: admin,
        body,
        pinned,
      });
    }),
  );

  // PATCH /:id  — body | pinned
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid note id" });
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : null;
      const pinned = typeof req.body?.pinned === "boolean" ? req.body.pinned : null;
      if (body == null && pinned == null) return res.status(400).json({ error: "nothing to update" });
      if (body != null && (body.length === 0 || body.length > 8000)) {
        return res.status(400).json({ error: "body 1..8000 chars" });
      }

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const result = await client.query<{ user_id: string }>(
        `UPDATE customer_notes
            SET body = COALESCE($2, body),
                pinned = COALESCE($3, pinned),
                updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
        RETURNING user_id`,
        [id, body, pinned],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "not found" });

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "update_note",
        targetUserId: result.rows[0].user_id,
        payload: { note_id: id, pinned, body_changed: body != null },
        context: extractAuditContext(req),
      });

      return res.json({ ok: true });
    }),
  );

  // DELETE /:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid note id" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const result = await client.query<{ user_id: string }>(
        `UPDATE customer_notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING user_id`,
        [id],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "not found" });

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "delete_note",
        targetUserId: result.rows[0].user_id,
        payload: { note_id: id },
        context: extractAuditContext(req),
      });

      return res.status(204).end();
    }),
  );

  return router;
}
