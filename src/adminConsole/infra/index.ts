/**
 * Infra dashboard sub-router (HEL infra PR #2).
 *
 * Mounts at /api/admin-console/infra. Splits into:
 *   /overview       — InfraOverview page reads
 *   /compute        — InfraCompute page reads
 *   /queues/_ui     — embedded bull-board (read-only in PR #2)
 *
 * Edge + Data sub-routers + mutation verbs land in subsequent PRs.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { createOverviewRoutes } from "./overviewRoutes";
import { createComputeRoutes } from "./computeRoutes";
import { createBullBoardRouter } from "./bullBoardMount";
import { createQueueInspectorRoutes } from "./queueInspector/routes";

export function createInfraRoutes(pool: Pool): Router {
  const router = Router();
  router.use("/overview", createOverviewRoutes(pool));
  router.use("/compute", createComputeRoutes(pool));
  router.use("/queues/inspector", createQueueInspectorRoutes(pool));
  router.use("/queues/_ui", createBullBoardRouter());
  return router;
}
