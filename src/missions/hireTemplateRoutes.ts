/**
 * HEL-214 / PR J scaffold — `POST /api/hire/templates`.
 *
 * TODO: HEL-214 wire real implementation. Pro Mode's PromptPreviewPane lets
 * power users save the team-assembly normalizedGoalDocument as a template;
 * the real handler will persist it to a `hire_templates` table. Today we
 * just echo the input with a fake id.
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.post(
  "/templates",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = (req.body ?? {}) as { normalizedGoalDocument?: unknown };
    res.status(201).json({
      id: `tmpl_${randomUUID().slice(0, 8)}`,
      normalizedGoalDocument: body.normalizedGoalDocument ?? null,
      createdAt: new Date().toISOString(),
    });
  }),
);

export default router;
