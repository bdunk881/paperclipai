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
import { createComputeMutationRoutes } from "./computeMutationRoutes";
import { createBullBoardRouter } from "./bullBoardMount";
import { createQueueInspectorRoutes } from "./queueInspector/routes";
import { createEdgeRoutes } from "./edgeRoutes";
import { createEdgeMutationRoutes } from "./edgeMutationRoutes";
import { createDataRoutes } from "./dataRoutes";
import { createDataMutationRoutes } from "./dataMutationRoutes";
import { createCostRoutes } from "./costRoutes";
import { requireAAL2 } from "../../middleware/requireAAL2";

export function createInfraRoutes(pool: Pool): Router {
  const router = Router();
  router.use("/overview", createOverviewRoutes(pool));
  router.use("/compute", createComputeRoutes(pool));
  router.use("/queues/inspector", createQueueInspectorRoutes(pool));
  // Bull-board accepts retry/promote/clean as of PR #6, so compose
  // requireAAL2 on the entire iframe path. Admins step up once per
  // session, then drive the UI freely.
  router.use("/queues/_ui", requireAAL2, createBullBoardRouter());
  router.use("/edge", createEdgeRoutes(pool));
  router.use("/data", createDataRoutes(pool));
  router.use("/cost", createCostRoutes(pool));
  // Mutation sub-routers — each carries requireAAL2 internally so the
  // read paths above stay AAL1.
  router.use("/compute/actions", createComputeMutationRoutes(pool));
  router.use("/edge/actions", createEdgeMutationRoutes(pool));
  router.use("/data/actions", createDataMutationRoutes(pool));
  return router;
}
