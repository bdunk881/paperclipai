/**
 * Impersonation routes — start, end, list a user's active sessions.
 *
 * Mounted under /api/admin-console/impersonation. The customer dashboard
 * verifies impersonation tokens via /api/impersonation/verify (a sibling
 * route mounted in src/app.ts, NOT under the admin auth gate).
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { isImpersonationConfigured, mintImpersonationToken } from "./impersonationStore";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL_SECONDS = 30 * 60;

export function createImpersonationRoutes(_pool: Pool): Router {
  const router = Router();

  // POST /:userId/start  — mint a read-only impersonation token
  router.post(
    "/:userId/start",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      if (!isImpersonationConfigured()) {
        return res.status(503).json({ error: "Impersonation not configured (set IMPERSONATION_TOKEN_SECRET)" });
      }

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "impersonation");

      const endsAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      const insert = await client.query<{ id: string }>(
        `INSERT INTO impersonation_sessions
            (admin_user_id, impersonated_user_id, mode, reason, ends_at)
          VALUES ($1, $2, 'read_only', $3, $4)
        RETURNING id`,
        [admin, userId, reason, endsAt.toISOString()],
      );
      const sessionId = insert.rows[0].id;

      const { token, payload } = mintImpersonationToken({
        impersonatorUserId: admin,
        impersonatedUserId: userId,
        sessionId,
        ttlSeconds: SESSION_TTL_SECONDS,
      });

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "start_impersonation",
        targetUserId: userId,
        reason,
        payload: { session_id: sessionId, jti: payload.jti, ends_at: endsAt.toISOString() },
        context: extractAuditContext(req),
      });

      return res.json({
        session_id: sessionId,
        token,
        ends_at: endsAt.toISOString(),
        // Where the admin should be sent to enter the customer view.
        dashboard_url: null,
      });
    }),
  );

  // POST /:sessionId/end
  router.post(
    "/:sessionId/end",
    asyncHandler(async (req, res) => {
      const sessionId = req.params.sessionId;
      if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: "invalid session id" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      const result = await client.query<{ impersonated_user_id: string }>(
        `UPDATE impersonation_sessions
            SET ended_at = now(), ended_reason = 'admin_ended'
          WHERE id = $1 AND ended_at IS NULL
        RETURNING impersonated_user_id`,
        [sessionId],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "session not active" });

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "end_impersonation",
        targetUserId: result.rows[0].impersonated_user_id,
        reason: "admin ended",
        payload: { session_id: sessionId },
        context: extractAuditContext(req),
      });

      return res.json({ ok: true });
    }),
  );

  // GET /user/:userId/active
  router.get(
    "/user/:userId/active",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      const result = await client.query(
        `SELECT id, admin_user_id, reason, started_at, ends_at
           FROM impersonation_sessions
          WHERE impersonated_user_id = $1
            AND ended_at IS NULL
            AND ends_at > now()
          ORDER BY started_at DESC`,
        [userId],
      );
      return res.json({ sessions: result.rows });
    }),
  );

  return router;
}
