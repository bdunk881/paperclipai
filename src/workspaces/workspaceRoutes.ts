import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { provisionDefaultWorkspace } from "../middleware/workspaceResolver";

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

    const listQuery = `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         LEFT JOIN workspace_members wm
           ON wm.workspace_id = w.id
        WHERE w.owner_user_id = $1
           OR wm.user_id = $1
        ORDER BY w.name ASC, w.id ASC`;

    let result = await pool.query<WorkspaceRow>(listQuery, [userId]);

    // If the user has zero workspaces, lazy-provision a default one and
    // re-query. Keeps the dashboard's WorkspaceContext bootstrap consistent
    // with the workspaceResolver middleware (which also auto-provisions on
    // first authenticated request). Without this, a freshly-signed-up user
    // sees an empty workspace list and the dashboard stays in the "no
    // workspaces" UI even though backend API calls would auto-create one.
    if (result.rows.length === 0) {
      try {
        await provisionDefaultWorkspace(pool, userId);
        result = await pool.query<WorkspaceRow>(listQuery, [userId]);
      } catch (err) {
        console.error("[workspaces] Auto-provision on list failed:", (err as Error).message);
        // Fall through — return the empty list rather than 500ing. The
        // resolver middleware will retry on the next API call.
      }
    }

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
