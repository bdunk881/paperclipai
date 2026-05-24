/**
 * HEL-214 / PR J scaffold — `POST /api/approval-rules/test`.
 *
 * TODO: HEL-214 wire real implementation. Today this just echoes a fixed
 * trace so the Pro Mode Rule Debugger reveal on the Approvals page can be
 * styled end-to-end. A follow-up will route the request through the same
 * evaluator that lives behind the approval-policy store.
 */
import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

interface TestBody {
  ruleId?: unknown;
  payload?: unknown;
}

router.post(
  "/test",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = (req.body ?? {}) as TestBody;
    const ruleId = typeof body.ruleId === "string" ? body.ruleId : "unknown_rule";

    // TODO: HEL-214 wire real implementation — call the actual policy
    // evaluator against `body.payload` and return its trace.
    const trace = [
      {
        clause: `rule.id == "${ruleId}"`,
        matched: true,
        reason: "scaffold response",
      },
      {
        clause: "payload.spendCents >= rule.threshold",
        matched: true,
        reason: "stub evaluator always matches threshold",
      },
      {
        clause: "actor.role == 'agent'",
        matched: false,
        reason: "stub does not inspect actor",
      },
    ];

    res.status(200).json({
      wouldTrigger: true,
      trace,
      echo: body.payload ?? null,
    });
  }),
);

export default router;
