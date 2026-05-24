/**
 * HEL-214 / PR J scaffold — `POST /api/mission-assignments/:id/replay`.
 *
 * TODO: HEL-214 wire real implementation. Real replay will re-enqueue the
 * captured assignment payload through the same dispatcher the original
 * delivery used; for now we 202-accept so the Pro Mode PayloadReplay
 * reveal is plumbed.
 */
import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.post(
  "/:id/replay",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    // TODO: HEL-214 wire real implementation — validate that the
    // assignment exists, capture the new payload, and re-dispatch.
    res.status(202).json({
      assignmentId: req.params.id,
      status: "queued",
      queued: true,
      message: "Scaffold response. Real replay arrives in a follow-up.",
    });
  }),
);

export default router;
