/**
 * Staff authorization helper (HEL-93).
 *
 * Gates AutoFlow-internal admin endpoints (currently: curated knowledge tier).
 * v1 uses an env-var allowlist of user IDs — the smallest possible gate that
 * doesn't require a schema change. A proper roles-table-backed `staff` role
 * lands in a follow-up if/when we have more than a handful of staff users.
 *
 * Env: `AUTOFLOW_STAFF_USER_IDS` — comma-separated list of Supabase auth
 * `sub` values. Empty/unset = no one is staff (admin endpoints return 403).
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";

let cachedStaffIds: Set<string> | null = null;

function loadStaffIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (cachedStaffIds) return cachedStaffIds;
  const raw = env.AUTOFLOW_STAFF_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  cachedStaffIds = new Set(ids);
  return cachedStaffIds;
}

/** Test-only — invalidates the cached allowlist so tests can mutate process.env. */
export function __resetStaffIdsCacheForTests(): void {
  cachedStaffIds = null;
}

export function isAutoflowStaff(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return loadStaffIds().has(userId);
}

/** Express middleware. Use after `requireAuth`. */
export function requireStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.auth?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!isAutoflowStaff(userId)) {
    return res.status(403).json({ error: "Staff access required" });
  }
  return next();
}
