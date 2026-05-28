/**
 * Infra dashboard Data reads (HEL infra PR #5).
 *
 * Mounted under /api/admin-console/infra/data. Returns a bundle for the
 * InfraData page covering Postgres, Redis, and Supabase.
 *
 * Mutation verbs (kill-query, flush-redis-pattern, sign-out-all,
 * delete-factor surfaced inline) land in PR #7 with requireAAL2.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { recordAdminAction } from "../auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import { inspectPostgres } from "./clients/postgresInspector";
import { inspectRedis } from "./clients/redisInspector";
import { inspectSupabase } from "./clients/supabaseAdminQueries";

export function createDataRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_infra_data",
        reason: "",
        context: extractAuditContext(req),
      });

      const [postgres, redis, supabase] = await Promise.all([
        inspectPostgres(),
        inspectRedis(),
        inspectSupabase(),
      ]);

      res.json({ postgres, redis, supabase });
    }),
  );

  return router;
}
