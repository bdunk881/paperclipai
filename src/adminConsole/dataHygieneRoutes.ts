/**
 * Data-hygiene routes — GDPR export, right-to-erasure, anonymize.
 *
 * Mounted under /api/admin-console/data-hygiene. Erasure is heavy and
 * two-person-rule (queued in pending_admin_actions); export and anonymize
 * fire immediately into the data_export_jobs queue (a worker picks them up).
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_TTL_MS = 5 * 60 * 1000;

export function createDataHygieneRoutes(_pool: Pool): Router {
  const router = Router();

  // POST /:userId/export — queue a GDPR export job
  router.post(
    "/:userId/export",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const insert = await client.query<{ id: string }>(
        `INSERT INTO data_export_jobs (user_id, requested_by_admin_id, kind, reason)
              VALUES ($1, $2, 'export', $3)
           RETURNING id`,
        [userId, admin, reason],
      );

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "queue_data_export",
        targetUserId: userId,
        reason,
        payload: { job_id: insert.rows[0].id },
        context: extractAuditContext(req),
      });

      return res.status(202).json({ job_id: insert.rows[0].id, status: "pending" });
    }),
  );

  // POST /:userId/erasure — queue a two-person delete
  router.post(
    "/:userId/erasure",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "user_deletion");

      const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
      const insert = await client.query<{ id: string }>(
        `INSERT INTO pending_admin_actions
            (action, requested_by_user_id, reason, target_user_id, expires_at)
          VALUES ('delete_user', $1, $2, $3, $4)
        RETURNING id`,
        [admin, reason, userId, expiresAt],
      );

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "queue_user_erasure",
        targetUserId: userId,
        reason,
        payload: { pending_action_id: insert.rows[0].id, expires_at: expiresAt },
        context: extractAuditContext(req),
      });

      return res.json({
        pending_action_id: insert.rows[0].id,
        expires_at: expiresAt,
        note: "Action queued. Requires confirmation by a different platform admin before it fires.",
      });
    }),
  );

  // POST /:userId/anonymize — PII scrub
  router.post(
    "/:userId/anonymize",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "anonymize_user",
        targetUserId: userId,
        reason,
        context: extractAuditContext(req),
      });

      await client.query(
        `UPDATE user_profiles
            SET display_name = 'Deleted User',
                updated_at = now()
          WHERE user_id = $1`,
        [userId],
      );

      const insert = await client.query<{ id: string }>(
        `INSERT INTO data_export_jobs (user_id, requested_by_admin_id, kind, reason)
              VALUES ($1, $2, 'anonymize', $3)
           RETURNING id`,
        [userId, admin, reason],
      );

      return res.json({ ok: true, job_id: insert.rows[0].id });
    }),
  );

  return router;
}
