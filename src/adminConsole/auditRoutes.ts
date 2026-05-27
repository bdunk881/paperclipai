/**
 * Audit-log reader routes. Mounted under /api/admin-console/audit.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAuditRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /?admin_user_id=&target_user_id=&action=&limit=&before=
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminUserId = typeof req.query.admin_user_id === "string" ? req.query.admin_user_id : null;
      const targetUserId = typeof req.query.target_user_id === "string" ? req.query.target_user_id : null;
      const targetWorkspaceId =
        typeof req.query.target_workspace_id === "string" ? req.query.target_workspace_id : null;
      const action = typeof req.query.action === "string" ? req.query.action : null;
      const limit = Math.min(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
      const before = typeof req.query.before === "string" ? req.query.before : null;

      if (targetWorkspaceId && !UUID_RE.test(targetWorkspaceId)) {
        return res.status(400).json({ error: "invalid target_workspace_id" });
      }

      const conds: string[] = [];
      const args: unknown[] = [];
      if (adminUserId) {
        args.push(adminUserId);
        conds.push(`admin_user_id = $${args.length}`);
      }
      if (targetUserId) {
        args.push(targetUserId);
        conds.push(`target_user_id = $${args.length}`);
      }
      if (targetWorkspaceId) {
        args.push(targetWorkspaceId);
        conds.push(`target_workspace_id = $${args.length}`);
      }
      if (action) {
        args.push(action);
        conds.push(`action = $${args.length}`);
      }
      if (before) {
        args.push(before);
        conds.push(`occurred_at < $${args.length}::timestamptz`);
      }
      args.push(limit);

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const result = await client.query(
        `SELECT id, admin_user_id, action, target_user_id, target_workspace_id, reason, payload, ip, user_agent, occurred_at
           FROM platform_admin_audit_log
           ${where}
          ORDER BY occurred_at DESC
          LIMIT $${args.length}`,
        args,
      );
      return res.json({ rows: result.rows });
    }),
  );

  return router;
}
