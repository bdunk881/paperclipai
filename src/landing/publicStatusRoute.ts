/**
 * Public status endpoint mounted at /api/public/status (HEL infra
 * follow-up). Caches in-process for 30s via computePublicStatus, plus
 * sets browser/CDN cache headers so a status.helloautoflow.com page hit
 * by lots of viewers doesn't put load on origin.
 *
 * Intentionally no auth — this URL is the source of truth for the
 * customer-facing status page.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { computePublicStatus } from "./publicStatusService";

const router = Router();

router.get(
  "/",
  asyncHandler<Request>(async (_req, res: Response) => {
    const payload = await computePublicStatus();
    // 30s shared cache; allow stale-while-revalidate so we never block a
    // viewer on a refresh.
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json(payload);
  }),
);

export default router;
