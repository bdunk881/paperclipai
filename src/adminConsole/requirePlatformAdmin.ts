/**
 * `requirePlatformAdmin` — auth gate for the admin-console API surface.
 *
 * Three-layer check:
 *   1. requireAuth (mounted upstream) confirms the JWT.
 *   2. The user's email matches AUTOFLOW_STAFF_USER_IDS / staff allowlist OR
 *      user_profiles.is_platform_admin = true.
 *   3. For routes that ALSO need MFA (most of them), `requireStaffMfa` is a
 *      separate downstream middleware that checks the JWT's `aal` claim.
 *
 * This middleware ALSO sets `app.is_platform_admin = 'true'` on the DB
 * session inside a transaction, which is what the SECURITY DEFINER lookup
 * functions and audit-table RLS policies gate on. We attach a PoolClient to
 * the request (`req.platformAdminDb`) so downstream handlers can do their
 * cross-tenant reads inside the same transaction.
 *
 * The client is RELEASED in a response-finish listener — handlers must NOT
 * release it themselves.
 */

import type { Response, NextFunction, RequestHandler } from "express";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { PlatformAdminRequest } from "./types";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by requirePlatformAdmin. PoolClient inside a transaction with `app.is_platform_admin = true`. */
    platformAdminDb?: PoolClient;
  }
}

interface CreateOpts {
  /**
   * Optional override for the email-allowlist check. Returns true when the
   * given user is allowed even without the is_platform_admin flag. Defaults
   * to checking AUTOFLOW_STAFF_USER_IDS (env-var allowlist, comma-separated
   * user IDs).
   */
  isAllowlistedStaff?: (userId: string) => boolean;
}

function defaultAllowlist(userId: string): boolean {
  const raw = process.env.AUTOFLOW_STAFF_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

/**
 * Returns a middleware that opens a transaction, validates the caller is a
 * platform admin, sets the session GUC, and attaches the client to req.
 *
 * Mount AFTER requireAuth.
 */
export function createRequirePlatformAdmin(pool: Pool, opts: CreateOpts = {}): RequestHandler {
  const isStaff = opts.isAllowlistedStaff ?? defaultAllowlist;

  return async (req, res, next) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      // HEL-299: set `app.current_user_id` BEFORE the user_profiles
      // SELECT. Migration 083 (HEL-273) enabled FORCE RLS on
      // `user_profiles` with a user-isolation policy keyed on
      // `app_current_user_id()`. Without this GUC, the lookup below
      // returned 0 rows for every caller — meaning `is_platform_admin`
      // could never resolve to true and the only path into the admin
      // console was the env-var allowlist. The SELECT is intentionally
      // narrow ("my own profile row"), which the user_isolation policy
      // allows once the GUC is set. `app.is_platform_admin` stays
      // unset until AFTER we confirm the caller is allowed — keep
      // that ordering so the cross-tenant admin_read policy can't be
      // gated by an unverified flag.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      // Look up the platform-admin flag from user_profiles. Fall back to the
      // env-var allowlist when no profile row exists yet (first sign-in for a
      // brand-new staff member). is_platform_admin flag is the canonical
      // grant; env var is the bootstrap.
      const profile = await client.query<{ is_platform_admin: boolean }>(
        "SELECT is_platform_admin FROM user_profiles WHERE user_id = $1",
        [userId],
      );
      const flagged = profile.rows[0]?.is_platform_admin === true;
      const allowlisted = isStaff(userId);

      if (!flagged && !allowlisted) {
        await client.query("ROLLBACK");
        client.release();
        res.status(403).json({ error: "Platform-admin access required" });
        return;
      }

      // Set the platform-admin GUC now that the caller is confirmed.
      // The current-user GUC was already set above.
      await client.query("SELECT set_config('app.is_platform_admin', 'true', true)");

      (req as PlatformAdminRequest).platformAdmin = {
        userId,
        email: authReq.auth?.email ?? null,
      };
      req.platformAdminDb = client;

      // Release the client when the response finishes — commit on 2xx, roll
      // back on 4xx/5xx so a failed handler doesn't leave a half-mutation.
      const release = () => {
        const c = req.platformAdminDb;
        req.platformAdminDb = undefined;
        if (!c) return;
        const finalize = res.statusCode >= 200 && res.statusCode < 400 ? "COMMIT" : "ROLLBACK";
        c.query(finalize)
          .catch(() => {
            // Already failed; swallow so the original status code reaches the client.
          })
          .finally(() => c.release());
      };
      res.once("finish", release);
      res.once("close", release);

      next();
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* swallow */
        }
        client.release();
      }
      next(err);
    }
  };
}

/**
 * Optional second-layer gate: require the JWT to have AAL2 (MFA-elevated).
 * Most admin routes mount this AFTER requirePlatformAdmin. Routes that need
 * to be reachable BEFORE MFA enrollment (e.g. the enroll-mfa endpoint) skip
 * it.
 */
export function requireStaffMfa(
  req: import("express").Request,
  res: Response,
  next: NextFunction,
): void {
  // The JWT `aal` claim is set by Supabase to 'aal1' (password) or 'aal2'
  // (with MFA factor). Different Supabase SDK versions surface the claim
  // under different keys; check the resolved auth context too if you've
  // stamped it there.
  const authReq = req as AuthenticatedRequest & { auth?: { aal?: string } };
  const aal = authReq.auth?.aal;
  if (aal !== "aal2") {
    res.status(403).json({ error: "MFA required for admin actions", code: "mfa_required" });
    return;
  }
  next();
}
