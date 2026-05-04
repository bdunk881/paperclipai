import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";

type WorkspaceRow = {
  id: string;
  name: string;
};

function slugifyWorkspaceName(value: string, fallbackId: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallbackId.toLowerCase();
}

export function createWorkspaceRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const result = await pool.query<WorkspaceRow>(
      `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         LEFT JOIN workspace_members wm
           ON wm.workspace_id = w.id
        WHERE w.owner_user_id = $1
           OR wm.user_id = $1
        ORDER BY w.name ASC, w.id ASC`,
      [userId],
    );

    const workspaces = result.rows.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: slugifyWorkspaceName(workspace.name, workspace.id),
    }));

    res.json(workspaces);
  });

  return router;
}
