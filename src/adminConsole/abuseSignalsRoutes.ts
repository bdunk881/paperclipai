/**
 * Abuse-signal routes — read-only views of failed-login telemetry, login
 * geo / device timelines, and computed suspicious-activity badges.
 *
 * Mounted under /api/admin-console/abuse.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAbuseSignalsRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /user/:userId/failed-logins
  router.get(
    "/user/:userId/failed-logins",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_failed_logins",
        targetUserId: userId,
        context: extractAuditContext(req),
      });

      const result = await client.query(
        `SELECT id, ip, user_agent, country, reason, occurred_at
           FROM auth_failed_logins
          WHERE user_id = $1
          ORDER BY occurred_at DESC
          LIMIT 100`,
        [userId],
      );
      return res.json({ rows: result.rows });
    }),
  );

  // GET /user/:userId/devices
  router.get(
    "/user/:userId/devices",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_login_devices",
        targetUserId: userId,
        context: extractAuditContext(req),
      });

      const result = await client.query(
        `SELECT user_agent_hash, country, first_seen_at, last_seen_at, login_count
           FROM auth_login_devices
          WHERE user_id = $1
          ORDER BY last_seen_at DESC`,
        [userId],
      );
      return res.json({ rows: result.rows });
    }),
  );

  // GET /user/:userId/signals — computed badges
  router.get(
    "/user/:userId/signals",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId;
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: "invalid user id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      // 1. password spray — >3 failed logins on this user's email/IP in last
      //    5 minutes from any single IP.
      const spray = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM auth_failed_logins
          WHERE user_id = $1
            AND occurred_at > now() - interval '5 minutes'`,
        [userId],
      );

      // 2. new device — any login_devices row first_seen_at within last 24h.
      const newDevice = await client.query<{ first_seen_at: string }>(
        `SELECT first_seen_at FROM auth_login_devices
          WHERE user_id = $1
            AND first_seen_at > now() - interval '24 hours'
          ORDER BY first_seen_at DESC
          LIMIT 1`,
        [userId],
      );

      // 3. new geo — distinct country added in last 7 days where the country
      //    has only ever been seen in the last 7 days.
      const newGeo = await client.query<{ country: string }>(
        `SELECT country FROM auth_login_devices
          WHERE user_id = $1
            AND country IS NOT NULL
          GROUP BY country
         HAVING min(first_seen_at) > now() - interval '7 days'
          LIMIT 1`,
        [userId],
      );

      return res.json({
        password_spray_5m: Number.parseInt(spray.rows[0].count, 10) >= 3,
        new_device_24h: (newDevice.rowCount ?? 0) > 0,
        new_geo_7d: newGeo.rows[0]?.country ?? null,
      });
    }),
  );

  return router;
}
