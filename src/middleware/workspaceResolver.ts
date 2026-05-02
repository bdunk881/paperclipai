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
import { Pool, PoolClient } from "pg";
import { AuthenticatedRequest } from "../auth/authMiddleware";

export interface WorkspaceAwareRequest extends AuthenticatedRequest {
  workspaceId?: string;
}

function getResultCount<T extends { rowCount: number | null; rows: unknown[] }>(result: T): number {
  return result.rowCount ?? result.rows.length;
}

async function ensureDefaultWorkspaceForUser(
  pool: Pool,
  userId: string,
): Promise<{ workspaceId: string; created: boolean } | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

    const ownedWorkspaces = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 2`,
      [userId],
    );
    const ownedWorkspaceCount = getResultCount(ownedWorkspaces);
    if (ownedWorkspaceCount > 1) {
      await client.query("COMMIT");
      return null;
    }
    if (ownedWorkspaceCount === 1) {
      await client.query("COMMIT");
      return { workspaceId: ownedWorkspaces.rows[0].id, created: false };
    }

    const memberWorkspaces = await client.query<{ id: string }>(
      `SELECT wm.workspace_id AS id FROM workspace_members wm
       WHERE wm.user_id = $1
       ORDER BY wm.created_at ASC LIMIT 2`,
      [userId],
    );
    const memberWorkspaceCount = getResultCount(memberWorkspaces);
    if (memberWorkspaceCount > 1) {
      await client.query("COMMIT");
      return null;
    }
    if (memberWorkspaceCount === 1) {
      await client.query("COMMIT");
      return { workspaceId: memberWorkspaces.rows[0].id, created: false };
    }

    const insertedWorkspace = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name, owner_user_id)
       VALUES ($1, $2)
       RETURNING id`,
      ["Personal Workspace", userId],
    );
    const workspaceId = insertedWorkspace.rows[0]?.id;
    if (!workspaceId) {
      throw new Error("workspace_bootstrap_insert_failed");
    }

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, userId],
    );
    await client.query("COMMIT");
    return { workspaceId, created: true };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback failures so the original error is preserved.
  }
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

        if (getResultCount(membershipCheck) === 0) {
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
      const ownedWorkspaceCount = getResultCount(ownedWorkspaces);

      if (ownedWorkspaceCount === 0) {
        // Check if user is a member of any workspace
        const memberWorkspaces = await pool.query(
          `SELECT wm.workspace_id AS id FROM workspace_members wm
           WHERE wm.user_id = $1
           ORDER BY wm.created_at ASC LIMIT 2`,
          [userId],
        );
        const memberWorkspaceCount = getResultCount(memberWorkspaces);

        if (memberWorkspaceCount === 0) {
          const bootstrapResult = await ensureDefaultWorkspaceForUser(pool, userId);
          if (!bootstrapResult) {
            res.status(400).json({
              error: "Multiple workspaces available. Specify X-Workspace-Id header.",
            });
            return;
          }

          req.workspaceId = bootstrapResult.workspaceId;
          next();
          return;
        }

        if (memberWorkspaceCount > 1) {
          res.status(400).json({
            error: "Multiple workspaces available. Specify X-Workspace-Id header.",
          });
          return;
        }

        req.workspaceId = memberWorkspaces.rows[0].id;
        next();
        return;
      }

      if (ownedWorkspaceCount > 1) {
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
