/**
 * GET /api/workspace/snapshot — aggregated read surface for dashboard Home.
 */

import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { getCachedHomeSnapshot } from "./workspaceSnapshotService";

export function createWorkspaceSnapshotRoutes(): Router {
  const router = Router();

  router.get(
    "/snapshot",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const surfaces =
        typeof req.query.surfaces === "string"
          ? req.query.surfaces.split(",").map((s) => s.trim())
          : ["home"];

      if (!surfaces.includes("home")) {
        res.status(400).json({ error: "Unsupported snapshot surface. Use surfaces=home" });
        return;
      }

      try {
        const snapshot = await getCachedHomeSnapshot(workspaceId, userId);
        res.setHeader("Cache-Control", "private, max-age=0");
        res.json(snapshot);
      } catch (err) {
        console.error(`[workspace-snapshot] failed: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to load workspace snapshot" });
      }
    }),
  );

  return router;
}
