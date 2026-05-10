/**
 * Role-gating middleware (HEL-19).
 *
 * Composes after `withWorkspace`: the chokepoint resolves the workspace and
 * the user's role on that workspace; this middleware then enforces that the
 * role is in the allowed set declared at the route mount.
 *
 *   app.use(
 *     "/api/billing/checkout",
 *     requireAuth,
 *     withWorkspace(pool),
 *     requireRole("owner", "billing"),
 *     checkoutRoutes,
 *   );
 *
 * Owner is an implicit superuser — `owner` always passes any `requireRole`
 * check, so call sites only need to enumerate the non-owner roles that
 * should additionally be allowed.
 *
 * If `withWorkspace` did not run (no `req.workspace`), the middleware fails
 * closed with 500 — that's a configuration bug, not an auth failure, and we
 * don't want to silently let the request through.
 */

import type { NextFunction, Response } from "express";
import type {
  WorkspaceAwareRequest,
  WorkspaceRole,
} from "./workspaceResolver";

export type RequireRoleMiddleware = (
  req: WorkspaceAwareRequest,
  res: Response,
  next: NextFunction,
) => void;

export function requireRole(...allowed: WorkspaceRole[]): RequireRoleMiddleware {
  if (allowed.length === 0) {
    throw new Error(
      "requireRole(...) called with no roles. Pass at least one role, or omit the middleware entirely.",
    );
  }

  // Owner always passes; ensure the implicit superuser is in the set so the
  // explicit-set check below is uniform.
  const allowedSet = new Set<WorkspaceRole>([...allowed, "owner"]);

  return function checkRole(req, res, next) {
    if (!req.workspace) {
      // Configuration error: requireRole() mounted without withWorkspace()
      // upstream. Fail closed — don't 401/403 because that would be
      // misleading to the caller; this is a server-side mount mistake.
      console.error(
        "[requireRole] no req.workspace set. Mount `withWorkspace(pool)` before requireRole().",
      );
      res.status(500).json({ error: "Server misconfiguration: workspace context missing." });
      return;
    }

    if (!allowedSet.has(req.workspace.role)) {
      res.status(403).json({
        error: "Forbidden: insufficient role for this resource.",
      });
      return;
    }

    next();
  };
}
