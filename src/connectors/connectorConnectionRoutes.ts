import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

interface ConnectorConnectionRow {
  id: string;
  workspace_id: string;
  kind: string;
  oauth_token_ref: string;
  scopes: string[];
  status: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export function createConnectorConnectionRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const kind =
      typeof req.query.kind === "string" ? req.query.kind : undefined;

    try {
      const rows = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const result = await client.query<ConnectorConnectionRow>(
            `SELECT id, workspace_id, kind, oauth_token_ref,
                    scopes, status, last_used_at, created_at, updated_at
               FROM connector_connections
              WHERE workspace_id = $1
                AND ($2::text IS NULL OR kind = $2)
              ORDER BY kind, created_at DESC`,
            [workspaceId, kind ?? null],
          );
          return result.rows;
        },
      );

      res.json({
        connections: rows.map((c) => ({
          id: c.id,
          workspaceId: c.workspace_id,
          kind: c.kind,
          oauthTokenRef: c.oauth_token_ref,
          scopes: c.scopes,
          status: c.status,
          lastUsedAt: c.last_used_at,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        })),
        total: rows.length,
      });
    } catch (err) {
      console.error(`[connector-connections] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load connector connections" });
    }
  });

  return router;
}
