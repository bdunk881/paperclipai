/**
 * Pending-admin-action queue routes — the second-person side of the two-person
 * rule. The first admin queues a high-impact action (suspend, delete user,
 * transfer ownership) which appears here for a different admin to confirm.
 *
 * The confirming admin MUST be a different user than the requester (enforced
 * by the CHECK constraint in migration 064).
 *
 * Mounted under /api/admin-console/pending-actions.
 */

import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PendingActionRow {
  id: string;
  action: string;
  requested_by_user_id: string;
  reason: string;
  target_user_id: string | null;
  target_workspace_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  expires_at: string;
}

async function executePendingAction(
  client: PoolClient,
  row: PendingActionRow,
  confirmingAdminId: string,
): Promise<{ ok: true; result?: unknown }> {
  switch (row.action) {
    case "suspend_workspace": {
      if (!row.target_workspace_id) throw new Error("suspend_workspace missing target_workspace_id");
      await client.query(
        `UPDATE workspaces
            SET status = 'suspended',
                status_changed_at = now(),
                status_changed_by = $2,
                status_reason = $3
          WHERE id = $1`,
        [row.target_workspace_id, confirmingAdminId, row.reason],
      );
      // Pause the budget so no in-flight runs continue to spend.
      await client.query(
        `INSERT INTO workspace_feature_overrides
            (workspace_id, flag, enabled, set_by_admin_id, reason)
          VALUES ($1, 'budget.paused', true, $2, $3)
          ON CONFLICT (workspace_id, flag) DO UPDATE
            SET enabled = true,
                set_by_admin_id = EXCLUDED.set_by_admin_id,
                reason = EXCLUDED.reason,
                created_at = now()`,
        [row.target_workspace_id, confirmingAdminId, `suspend: ${row.reason}`],
      );
      return { ok: true };
    }
    case "delete_user": {
      if (!row.target_user_id) throw new Error("delete_user missing target_user_id");
      // Schedule hard delete 30 days out; soft-delete now via data_export_jobs.
      const hardDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const insert = await client.query<{ id: string }>(
        `INSERT INTO data_export_jobs
            (user_id, requested_by_admin_id, kind, reason, hard_delete_at)
          VALUES ($1, $2, 'erasure', $3, $4)
        RETURNING id`,
        [row.target_user_id, confirmingAdminId, row.reason, hardDeleteAt],
      );
      return { ok: true, result: { job_id: insert.rows[0].id, hard_delete_at: hardDeleteAt } };
    }
    case "transfer_workspace_ownership": {
      if (!row.target_workspace_id) throw new Error("transfer missing target_workspace_id");
      const newOwner = String((row.payload as { new_owner_user_id?: string }).new_owner_user_id ?? "");
      if (!UUID_RE.test(newOwner)) throw new Error("transfer missing valid new_owner_user_id");
      await client.query("UPDATE workspaces SET owner_user_id = $2 WHERE id = $1", [
        row.target_workspace_id,
        newOwner,
      ]);
      // Ensure they're a member with owner role.
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
              VALUES ($1, $2, 'owner')
          ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`,
        [row.target_workspace_id, newOwner],
      );
      return { ok: true };
    }
    default:
      throw new Error(`unknown pending action ${row.action}`);
  }
}

export function createPendingActionsRoutes(_pool: Pool): Router {
  const router = Router();

  // GET / — list pending actions awaiting a second admin.
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const result = await client.query<PendingActionRow>(
        `SELECT id, action, requested_by_user_id, reason, target_user_id,
                target_workspace_id, payload, status, created_at, expires_at
           FROM pending_admin_actions
          WHERE status = 'pending' AND expires_at > now()
          ORDER BY created_at DESC
          LIMIT 100`,
      );
      return res.json({ actions: result.rows });
    }),
  );

  // POST /:id/confirm — execute the queued action.
  router.post(
    "/:id/confirm",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid pending action id" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const lookup = await client.query<PendingActionRow>(
        `SELECT id, action, requested_by_user_id, reason, target_user_id,
                target_workspace_id, payload, status, created_at, expires_at
           FROM pending_admin_actions
          WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (lookup.rowCount === 0) return res.status(404).json({ error: "not found" });
      const row = lookup.rows[0];
      if (row.status !== "pending") return res.status(409).json({ error: `already ${row.status}` });
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          "UPDATE pending_admin_actions SET status = 'expired' WHERE id = $1",
          [id],
        );
        return res.status(410).json({ error: "expired" });
      }
      if (row.requested_by_user_id === admin) {
        return res.status(403).json({ error: "confirming admin must differ from requester" });
      }

      const confirmAction =
        row.action === "suspend_workspace"
          ? "confirm_suspend_workspace"
          : row.action === "delete_user"
            ? "confirm_user_erasure"
            : "confirm_transfer_ownership";

      await recordAdminAction(client, {
        adminUserId: admin,
        action: confirmAction,
        targetUserId: row.target_user_id,
        targetWorkspaceId: row.target_workspace_id,
        reason: row.reason,
        payload: { pending_action_id: id, requested_by: row.requested_by_user_id },
        context: extractAuditContext(req),
      });

      const result = await executePendingAction(client, row, admin);

      await client.query(
        "UPDATE pending_admin_actions SET status = 'confirmed', confirmed_by_user_id = $2, confirmed_at = now() WHERE id = $1",
        [id, admin],
      );

      return res.json({ ok: true, result: result.result ?? null });
    }),
  );

  // POST /:id/cancel
  router.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid pending action id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const result = await client.query(
        `UPDATE pending_admin_actions
            SET status = 'cancelled', cancelled_at = now(), cancelled_by_user_id = $2
          WHERE id = $1 AND status = 'pending'`,
        [id, admin],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "not found or already finalised" });

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "cancel_pending_action",
        reason,
        payload: { pending_action_id: id },
        context: extractAuditContext(req),
      });

      return res.json({ ok: true });
    }),
  );

  return router;
}
