import { Request, Response, NextFunction } from "express";
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

function readExplicitWorkspaceHeader(req: Request): string | null {
  const headerValue = req.headers["x-workspace-id"];
  if (typeof headerValue !== "string") {
    return null;
  }

  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function ensureWorkspaceMembership(pool: Pool, workspaceId: string, userId: string): Promise<boolean> {
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
    [workspaceId, userId],
  );

  return getResultCount(membershipCheck) > 0;
}

async function resolveDefaultWorkspaceId(pool: Pool, userId: string): Promise<string | null> {
  const ownedWorkspaces = await pool.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 2`,
    [userId],
  );
  const ownedWorkspaceCount = getResultCount(ownedWorkspaces);

  if (ownedWorkspaceCount > 1) {
    return null;
  }
  if (ownedWorkspaceCount === 1) {
    return ownedWorkspaces.rows[0].id;
  }

  const memberWorkspaces = await pool.query<{ id: string }>(
    `SELECT wm.workspace_id AS id FROM workspace_members wm
     WHERE wm.user_id = $1
     ORDER BY wm.created_at ASC LIMIT 2`,
    [userId],
  );
  const memberWorkspaceCount = getResultCount(memberWorkspaces);

  if (memberWorkspaceCount > 1) {
    return null;
  }
  if (memberWorkspaceCount === 1) {
    return memberWorkspaces.rows[0].id;
  }

  return null;
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

    const explicitWorkspaceId = readExplicitWorkspaceHeader(req);
    const claimedWorkspaceId = req.auth?.workspaceId?.trim() || null;
    const candidateWorkspaceId = explicitWorkspaceId || claimedWorkspaceId;

    if (candidateWorkspaceId) {
      if (!isUuid(candidateWorkspaceId)) {
        res.status(400).json({ error: "Invalid workspace ID format." });
        return;
      }

      try {
        const isMember = await ensureWorkspaceMembership(pool, candidateWorkspaceId, userId);
        if (!isMember) {
          res.status(403).json({ error: "Not a member of the requested workspace." });
          return;
        }

        req.workspaceId = candidateWorkspaceId;
        next();
        return;
      } catch (err) {
        console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
        res.status(500).json({ error: "Failed to resolve workspace context." });
        return;
      }
    }

    try {
      const defaultWorkspaceId = await resolveDefaultWorkspaceId(pool, userId);
      if (!defaultWorkspaceId) {
        res.status(400).json({
          error: "Multiple workspaces available. Specify X-Workspace-Id header.",
        });
        return;
      }

      req.workspaceId = defaultWorkspaceId;
      next();
    } catch (err) {
      console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
      res.status(500).json({ error: "Failed to resolve workspace context." });
    }
  };
}

export function createExplicitWorkspaceHeaderResolver() {
  return function resolveExplicitWorkspaceHeader(
    req: WorkspaceAwareRequest,
    _res: Response,
    next: NextFunction,
  ): void {
    const explicitWorkspaceId = readExplicitWorkspaceHeader(req);
    const claimedWorkspaceId = req.auth?.workspaceId?.trim() || null;
    req.workspaceId = explicitWorkspaceId || claimedWorkspaceId || undefined;
    next();
  };
}
