/**
 * Workspace operations — status changes, kill-switch with two-person rule,
 * budget pause, ownership transfer.
 *
 * High-impact actions (suspend, transfer) go through pending_admin_actions —
 * one admin queues, a second confirms within the expiry window.
 *
 * Mounted under /api/admin-console/workspace-ops.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_TTL_MS = 5 * 60 * 1000;

export function createWorkspaceOpsRoutes(_pool: Pool): Router {
  const router = Router();

  // PATCH /:workspaceId/status — locked | active
  router.patch(
    "/:workspaceId/status",
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: "invalid workspace id" });
      const status = String(req.body?.status ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();

      if (!["active", "locked"].includes(status)) {
        return res.status(400).json({ error: "status must be 'active' or 'locked' (use /suspend for 'suspended')" });
      }
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: status === "locked" ? "lock_workspace" : "unlock_workspace",
        targetWorkspaceId: workspaceId,
        reason,
        payload: { status },
        context: extractAuditContext(req),
      });

      const result = await client.query(
        `UPDATE workspaces
            SET status = $2,
                status_changed_at = now(),
                status_changed_by = $3,
                status_reason = $4
          WHERE id = $1
        RETURNING id, status`,
        [workspaceId, status, admin, reason],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "workspace not found" });
      return res.json({ workspace: result.rows[0] });
    }),
  );

  // POST /:workspaceId/suspend  — queues a two-person confirmation
  router.post(
    "/:workspaceId/suspend",
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: "invalid workspace id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
      const insert = await client.query<{ id: string }>(
        `INSERT INTO pending_admin_actions
            (action, requested_by_user_id, reason, target_workspace_id, expires_at)
          VALUES ('suspend_workspace', $1, $2, $3, $4)
        RETURNING id`,
        [admin, reason, workspaceId, expiresAt],
      );

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "queue_suspend_workspace",
        targetWorkspaceId: workspaceId,
        reason,
        payload: { pending_action_id: insert.rows[0].id, expires_at: expiresAt },
        context: extractAuditContext(req),
      });

      return res.json({
        pending_action_id: insert.rows[0].id,
        expires_at: expiresAt,
        note: "Action queued. Requires confirmation by a different platform admin via POST /pending-actions/:id/confirm before it fires.",
      });
    }),
  );

  // POST /:workspaceId/budget-pause — set ceiling to $0 immediately (no two-person rule, reversible)
  router.post(
    "/:workspaceId/budget-pause",
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: "invalid workspace id" });
      const reason = String(req.body?.reason ?? "").trim();
      const pause = req.body?.pause !== false;
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "set_workspace_budget_pause",
        targetWorkspaceId: workspaceId,
        reason,
        payload: { pause },
        context: extractAuditContext(req),
      });

      // Use the existing feature-override surface — entitlements layer reads
      // 'budget.paused' and short-circuits run start when true.
      await client.query(
        `INSERT INTO workspace_feature_overrides
            (workspace_id, flag, enabled, set_by_admin_id, reason)
          VALUES ($1, 'budget.paused', $2, $3, $4)
          ON CONFLICT (workspace_id, flag)
          DO UPDATE SET enabled = EXCLUDED.enabled,
                        set_by_admin_id = EXCLUDED.set_by_admin_id,
                        reason = EXCLUDED.reason,
                        created_at = now()`,
        [workspaceId, pause, admin, reason],
      );

      return res.json({ ok: true, paused: pause });
    }),
  );

  return router;
}
