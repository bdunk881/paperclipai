/**
 * `requireWebAuthnAal2` — strict step-up gate for the most sensitive admin
 * verbs (HEL infra follow-up). Wraps the existing requireAAL2 chain but
 * REJECTS TOTP and recovery-code attestations. Used by the platform-admin
 * revoke endpoint so a stolen-session attacker can't elevate themselves
 * even if they reach the admin app — TOTP-only step-up doesn't satisfy
 * this gate.
 *
 * The 401 response carries `reason: "staff_requires_passkey"` so the
 * existing MfaStepUpModal swaps its copy to "AutoFlow staff endpoints
 * require a passkey." and re-runs WebAuthn.
 */

import type { Response, NextFunction } from "express";
import {
  AAL2_ATTESTATION_COOKIE,
  requireAAL2,
  verifyAal2AttestationCookie,
} from "./requireAAL2";
import type { AuthenticatedRequest } from "../auth/authMiddleware";

function readCookie(req: AuthenticatedRequest): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || !raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === AAL2_ATTESTATION_COOKIE) return rest.join("=");
  }
  return null;
}

export async function requireWebAuthnAal2(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // First defer to the regular AAL2 gate. If it passes the request, we
  // then verify the method was WebAuthn — Supabase's AAL2 covers
  // TOTP/SMS/passkey at the JWT level but doesn't differentiate by method
  // on its own; the cookie does.
  let nextCalled = false;
  await requireAAL2(req, res, () => {
    nextCalled = true;
  });
  // requireAAL2 either calls next() or sends a 401. If it didn't call
  // next(), the response is on its way out and we MUST NOT call res
  // again.
  if (!nextCalled) return;

  // At this point the cookie is the most reliable source of "what
  // method satisfied AAL2 most recently". If there's no cookie at all
  // requireAAL2 would have rejected — but a Supabase-only AAL2 (TOTP via
  // Supabase factor list) is the corner case we close here.
  const cookie = readCookie(req);
  if (!cookie) {
    res.status(401).json({
      error: "mfa_step_up_required",
      reason: "staff_requires_passkey",
    });
    return;
  }
  if (!req.auth?.sub) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const verified = verifyAal2AttestationCookie(cookie, req.auth.sub);
  if (!verified.valid || verified.claims?.method !== "webauthn") {
    res.status(401).json({
      error: "mfa_step_up_required",
      reason: "staff_requires_passkey",
    });
    return;
  }
  next();
}
