import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";

type WorkspaceRow = {
  id: string;
  name: string;
};

type CreateWorkspaceRow = WorkspaceRow;

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

  router.post("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required and must be a non-empty string" });
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const insertedWorkspace = await client.query<CreateWorkspaceRow>(
        `INSERT INTO workspaces (name, owner_user_id)
         VALUES ($1, $2)
         RETURNING id, name`,
        [name, userId],
      );
      const workspace = insertedWorkspace.rows[0];
      if (!workspace) {
        throw new Error("workspace_create_failed");
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspace.id, userId],
      );

      await client.query("COMMIT");
      res.status(201).json({
        id: workspace.id,
        name: workspace.name,
        slug: slugifyWorkspaceName(workspace.name, workspace.id),
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original creation error.
        }
      }
      console.error("[workspaces] Failed to create workspace:", (error as Error).message);
      res.status(500).json({ error: "Failed to create workspace" });
    } finally {
      client?.release();
    }
  });

  return router;
}
