import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { randomBytes } from "crypto";
import { AuthenticatedRequest } from "../auth/authMiddleware";

/**
 * Canonical workspace role set (HEL-19, migration 026).
 *
 * - `owner`     — full access; billing; delete workspace. Implicit superuser
 *                 in `requireRole()` checks (always passes).
 * - `admin`     — full operational access EXCEPT billing + delete.
 * - `billing`   — `/api/billing/*` only.
 * - `operator`  — runs / approvals / cost views.
 * - `developer` — workflows / connectors / LLM credentials.
 * - `approver`  — resolves approvals (HITL specialists).
 * - `member`    — transitional / least-privileged. Pre-canonical rows from
 *                 the legacy `{owner, admin, member}` enum land here.
 */
export type WorkspaceRole =
  | "owner"
  | "admin"
  | "billing"
  | "operator"
  | "developer"
  | "approver"
  | "member";

/**
 * The chokepoint type every authenticated handler should depend on (HEL-18).
 *
 * - `workspaceId` is the legacy field — kept populated for backwards compat
 *   with existing handlers. New code should prefer `workspace.id` and
 *   `workspace.role`.
 * - `workspace` is the canonical typed setter. When the middleware finishes
 *   successfully, both are guaranteed non-null.
 */
export interface WorkspaceAwareRequest extends AuthenticatedRequest {
  workspaceId?: string;
  workspace?: {
    id: string;
    role: WorkspaceRole;
  };
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

/**
 * Returns the user's role in the workspace, or null if not a member.
 *
 * SECURITY (HEL-18): a spoofed workspace UUID in the URL or x-workspace-id
 * header MUST land in the null branch — the membership predicate gates
 * downstream queries from ever running with the wrong workspace_id.
 */
async function resolveWorkspaceRole(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const result = await pool.query<{ role: WorkspaceRole }>(
    `SELECT
       CASE
         WHEN w.owner_user_id = $2 THEN 'owner'::text
         ELSE wm.role
       END AS role
     FROM workspaces w
     LEFT JOIN workspace_members wm
       ON wm.workspace_id = w.id AND wm.user_id = $2
     WHERE w.id = $1
       AND (w.owner_user_id = $2 OR wm.user_id = $2)
     LIMIT 1`,
    [workspaceId, userId],
  );

  if (getResultCount(result) === 0) return null;
  return result.rows[0].role;
}

async function ensureWorkspaceMembership(pool: Pool, workspaceId: string, userId: string): Promise<boolean> {
  return (await resolveWorkspaceRole(pool, workspaceId, userId)) !== null;
}

async function resolveDefaultWorkspaceId(pool: Pool, userId: string): Promise<string | null> {
  // Returns the oldest workspace the user owns, or (if they don't own any) the
  // oldest workspace they're a member of. The dashboard's WorkspaceContext
  // bootstraps the active workspace asynchronously and the switcher writes
  // X-Workspace-Id once the user picks one explicitly — but during the
  // bootstrap race or on first-page-load, requests reach this middleware
  // without the header. Returning a deterministic default unblocks those
  // calls; clients that need explicit selection still set X-Workspace-Id
  // and the candidateWorkspaceId branch above honors it.
  const ownedWorkspaces = await pool.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  if (getResultCount(ownedWorkspaces) >= 1) {
    return ownedWorkspaces.rows[0].id;
  }

  const memberWorkspaces = await pool.query<{ id: string }>(
    `SELECT wm.workspace_id AS id FROM workspace_members wm
     WHERE wm.user_id = $1
     ORDER BY wm.created_at ASC LIMIT 1`,
    [userId],
  );
  if (getResultCount(memberWorkspaces) >= 1) {
    return memberWorkspaces.rows[0].id;
  }

  return null;
}

const DEFAULT_WORKSPACE_NAME = "My Workspace";

/**
 * Lazily provisions a default workspace for a freshly-signed-up user (HEL-83
 * follow-on). Brad hit this immediately after the Supabase auth cutover: the
 * dashboard's auth-callback fires API calls before any "create a workspace"
 * UX exists, so newly-authenticated users with zero workspaces would otherwise
 * get a confusing "Multiple workspaces available" 400 on every request.
 *
 * Concurrency: two parallel first requests from the same user could both try
 * to create. We serialize per-user via a Postgres advisory lock (hash of
 * userId) so only one INSERT wins; the second observes the row created by
 * the first and short-circuits. The lock is transaction-scoped and released
 * automatically on COMMIT/ROLLBACK.
 *
 * Naming: "My Workspace" is intentionally generic. The dashboard's later
 * first-login UX can prompt for a real name and PATCH it; auto-create keeps
 * the API path unblocked in the meantime.
 */
export async function provisionDefaultWorkspace(pool: Pool, userId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Advisory lock keyed off a stable hash of userId — Postgres' hashtext()
    // is portable, deterministic, and avoids needing a dedicated lock table.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

    // Re-check inside the lock in case a concurrent request already
    // provisioned. Same query as resolveDefaultWorkspaceId's owned branch.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    if (getResultCount(existing) >= 1) {
      await client.query("COMMIT");
      return existing.rows[0].id;
    }

    const outboundSecret = randomBytes(32).toString("hex");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name, owner_user_id, outbound_webhook_secret) VALUES ($1, $2, $3) RETURNING id`,
      [DEFAULT_WORKSPACE_NAME, userId, outboundSecret],
    );
    const workspaceId = inserted.rows[0]?.id;
    if (!workspaceId) {
      throw new Error("provisionDefaultWorkspace: INSERT returned no id");
    }

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, userId],
    );

    await client.query("COMMIT");
    console.log(`[workspaceResolver] Auto-provisioned default workspace ${workspaceId} for user ${userId}`);
    return workspaceId;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw err;
  } finally {
    client.release();
  }
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
        const role = await resolveWorkspaceRole(pool, candidateWorkspaceId, userId);
        if (role === null) {
          // SECURITY: opaque 403 — don't leak whether the workspace exists.
          // A user who guesses a foreign workspace UUID gets the same
          // response as one who passes a non-existent UUID.
          res.status(403).json({ error: "Not a member of the requested workspace." });
          return;
        }

        req.workspaceId = candidateWorkspaceId;
        req.workspace = { id: candidateWorkspaceId, role };
        next();
        return;
      } catch (err) {
        console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
        res.status(500).json({ error: "Failed to resolve workspace context." });
        return;
      }
    }

    try {
      let defaultWorkspaceId = await resolveDefaultWorkspaceId(pool, userId);
      if (!defaultWorkspaceId) {
        // First authenticated request for a brand-new user — lazy-provision
        // a default workspace so the dashboard isn't stuck on a 400. The
        // previous "Multiple workspaces available. Specify X-Workspace-Id"
        // message fired in this branch too, which was misleading: there were
        // zero workspaces, not multiple. Auto-create unblocks /auth/callback
        // and every subsequent API call.
        defaultWorkspaceId = await provisionDefaultWorkspace(pool, userId);
      }

      const role = await resolveWorkspaceRole(pool, defaultWorkspaceId, userId);
      if (role === null) {
        // Should be impossible after resolve-or-provision, but guard anyway.
        res.status(403).json({ error: "Not a member of the resolved workspace." });
        return;
      }

      req.workspaceId = defaultWorkspaceId;
      req.workspace = { id: defaultWorkspaceId, role };
      next();
    } catch (err) {
      console.error("[workspaceResolver] Failed to resolve workspace:", (err as Error).message);
      res.status(500).json({ error: "Failed to resolve workspace context." });
    }
  };
}

/**
 * Canonical alias for `createWorkspaceResolver` (HEL-18).
 *
 * Use this name in new code so the chokepoint reads naturally at the route
 * mount: `app.use("/api/foo", requireAuth, withWorkspace, fooRoutes)`.
 *
 * Returns the same Express middleware as `createWorkspaceResolver`. Both
 * exports remain so existing call sites keep working through the rename
 * window.
 */
export function withWorkspace(pool: Pool) {
  return createWorkspaceResolver(pool);
}

export function createExplicitWorkspaceHeaderResolver() {
  return function resolveExplicitWorkspaceHeader(
    req: WorkspaceAwareRequest,
    _res: Response,
    next: NextFunction,
  ): void {
    const explicitWorkspaceId = readExplicitWorkspaceHeader(req);
    const claimedWorkspaceId = req.auth?.workspaceId?.trim() || null;
    const resolved = explicitWorkspaceId || claimedWorkspaceId || undefined;
    req.workspaceId = resolved;
    if (resolved) {
      // No-Postgres path (test / dev fallback). We can't run the membership
      // check, so default to the LEAST-privileged role ('member') rather than
      // 'owner' — defaulting to owner would mask permission bugs in dev that
      // would surface in prod, and would let role-gated actions silently
      // succeed when they should fail. Tests that need a specific role
      // should mock the resolver explicitly.
      req.workspace = { id: resolved, role: "member" };
    }
    next();
  };
}
