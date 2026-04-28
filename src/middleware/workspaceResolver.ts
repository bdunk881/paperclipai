/**
 * Workspace resolution middleware for Express.
 *
 * Resolves the workspace ID for an authenticated request by:
 * 1. Checking for an explicit X-Workspace-Id header
 * 2. Falling back to the user's default (sole-owner) workspace
 * 3. Validating workspace membership before allowing access
 *
 * Attaches `req.workspaceId` for downstream handlers.
 *
 * ALT-1915 Phase 1.2
 */

import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "../auth/authMiddleware";

export interface WorkspaceAwareRequest extends AuthenticatedRequest {
  workspaceId?: string;
}

/**
 * Creates Express middleware that resolves and validates workspace context.
 *
 * @param pool - PostgreSQL connection pool for membership queries
 */
export function createWorkspaceResolver(pool: Pool) {
  return async function resolveWorkspace(
    req: WorkspaceAwareRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const explicitWorkspaceId =
      typeof req.headers["x-workspace-id"] === "string"
        ? req.headers["x-workspace-id"].trim()
        : null;

    try {
      if (explicitWorkspaceId) {
        // Validate UUID format to prevent injection
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicitWorkspaceId)) {
          res.status(400).json({ error: "Invalid workspace ID format." });
          return;
        }

        // Verify membership: user must be owner or member of the requested workspace
        const membershipCheck = await pool.query(
          `SELECT 1 FROM workspaces w
           WHERE w.id = $1
             AND (
               w.owner_user_id = $2
               OR EXISTS (
                 SELECT 1 FROM workspace_members wm
                 WHERE wm.workspace_id = w.id AND wm.user_id = $2
               )
             )`,
          [explicitWorkspaceId, userId],
        );

        if (membershipCheck.rowCount === 0) {
          res.status(403).json({ error: "Not a member of the requested workspace." });
          return;
        }

        req.workspaceId = explicitWorkspaceId;
        next();
        return;
      }

      // No explicit workspace — resolve default (user's sole owned workspace)
      const ownedWorkspaces = await pool.query(
        `SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 2`,
        [userId],
      );

      if (ownedWorkspaces.rowCount === 0) {
        // Check if user is a member of any workspace
        const memberWorkspaces = await pool.query(
          `SELECT wm.workspace_id AS id FROM workspace_members wm
           WHERE wm.user_id = $1
           ORDER BY wm.created_at ASC LIMIT 2`,
          [userId],
        );

        if (memberWorkspaces.rowCount === 0) {
          res.status(404).json({ error: "No workspace found for user." });
          return;
        }

        if (memberWorkspaces.rowCount > 1) {
          res.status(400).json({
            error: "Multiple workspaces available. Specify X-Workspace-Id header.",
          });
          return;
        }

        req.workspaceId = memberWorkspaces.rows[0].id;
        next();
        return;
      }

      if (ownedWorkspaces.rowCount > 1) {
        res.status(400).json({
          error: "Multiple workspaces available. Specify X-Workspace-Id header.",
        });
        return;
      }

      req.workspaceId = ownedWorkspaces.rows[0].id;
      next();
    } catch (err) {
      console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
      res.status(500).json({ error: "Failed to resolve workspace context." });
    }
  };
}
