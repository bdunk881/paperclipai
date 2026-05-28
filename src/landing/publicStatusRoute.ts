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
import {
  computePublicStatus,
  listRecentStatusEvents,
} from "./publicStatusService";

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

// Public incident timeline — the most recent component-level transitions.
// Cached more aggressively (5min) because transitions are rare; even a
// minute-old timeline is fine.
router.get(
  "/events",
  asyncHandler<Request>(async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50), 200);
    const events = await listRecentStatusEvents(limit);
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json({ events });
  }),
);

export default router;
