/**
 * Comms reputation routes (HEL-728) — mounted under
 * /api/admin-console/comms-reputation. requirePlatformAdmin + requireAAL2 are
 * applied once upstream in createAdminConsoleRoutes, so req.platformAdminDb (the
 * GUC-set client) is in scope and the SECURITY DEFINER aggregation is gated by
 * app_is_platform_admin().
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";
import {
  mapReputationDbRow,
  toCommsReputationMetric,
  type RawReputationDbRow,
} from "../comms/reputationMetrics";

export function createCommsReputationRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /?days=30 — per-tenant comms reputation over the last N days.
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const days = Math.min(
        Math.max(Number.parseInt(String(req.query.days ?? "30"), 10) || 30, 1),
        365,
      );
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_comms_reputation",
        reason: "",
        payload: { days },
        context: extractAuditContext(req),
      });

      const result = await client.query<RawReputationDbRow>(
        "SELECT * FROM admin_comms_reputation($1)",
        [since],
      );
      const workspaces = result.rows.map((row) =>
        toCommsReputationMetric(mapReputationDbRow(row)),
      );
      return res.json({ since, days, workspaces });
    }),
  );

  return router;
}
