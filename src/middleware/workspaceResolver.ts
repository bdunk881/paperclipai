import { Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "../auth/authMiddleware";

export interface WorkspaceAwareRequest extends AuthenticatedRequest {
  workspaceId?: string;
}

function getResultCount<T extends { rowCount: number | null; rows: unknown[] }>(result: T): number {
  return result.rowCount ?? result.rows.length;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function createWorkspaceResolver(pool: Pool) {
  return async function resolveWorkspace(
    req: WorkspaceAwareRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const claimedWorkspaceId = req.auth?.workspaceId?.trim();
    if (!claimedWorkspaceId) {
      res.status(401).json({ error: "Workspace claim required." });
      return;
    }

    if (!isUuid(claimedWorkspaceId)) {
      res.status(400).json({ error: "Invalid workspace ID format." });
      return;
    }

    try {
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
        [claimedWorkspaceId, userId],
      );

      if (getResultCount(membershipCheck) === 0) {
        res.status(403).json({ error: "Not a member of the requested workspace." });
        return;
      }

      req.workspaceId = claimedWorkspaceId;
      next();
    } catch (err) {
      console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
      res.status(500).json({ error: "Failed to resolve workspace context." });
    }
  };
}
