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
import {
  AAL2_ATTESTATION_COOKIE,
  verifyAal2AttestationCookie,
} from "../middleware/requireAAL2";

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

function extractAttestationCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || !raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== AAL2_ATTESTATION_COOKIE) continue;
    return part.slice(idx + 1).trim() || null;
  }
  return null;
}

/**
 * Staff routes are phish-resistance-strict. AAL2 alone isn't enough — the
 * factor that produced it must be a passkey (WebAuthn) or a one-time
 * recovery code. TOTP is rejected because Evilginx-class reverse proxies
 * can relay 6-digit codes in real time.
 *
 * If the staff member is behind Cloudflare Access (the recommended
 * production posture) the CF-Access JWT will already have proven a FIDO2
 * key at the edge — this is belt + suspenders inside the app.
 */
function staffHasPhishResistantAal2(req: AuthenticatedRequest): boolean {
  const cookie = extractAttestationCookie(req);
  if (cookie && req.auth?.sub) {
    const verified = verifyAal2AttestationCookie(cookie, req.auth.sub);
    if (verified.valid && verified.claims) {
      return verified.claims.method === "webauthn" || verified.claims.method === "recovery_code";
    }
  }
  // Supabase TOTP path is intentionally NOT accepted for staff. If the
  // method here is "totp" we fail closed.
  return false;
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
  if (process.env.MFA_STAFF_ENFORCEMENT === "off") {
    // Escape hatch for staging soak / break-glass. Production must leave
    // this unset so the phish-resistant gate is in force.
    return next();
  }
  if (!staffHasPhishResistantAal2(req)) {
    return res.status(401).json({
      error: "mfa_step_up_required",
      reason: "staff_requires_passkey",
    });
  }
  return next();
}
