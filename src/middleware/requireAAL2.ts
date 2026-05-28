/**
 * `requireAAL2` — step-up auth gate (HEL-mfa).
 *
 * Some operations are too risky to authorize with just AAL1 (password +
 * session). Billing changes, member admin, password rotation, LLM credential
 * rotation, audit log reads, and every `/api/admin/*` route call this
 * middleware AFTER `requireAuth` to demand a fresh second-factor verification.
 *
 * "Fresh" = within MFA_STEP_UP_TTL_SECONDS (default 15 min). Two acceptance
 * paths:
 *
 *   1. Supabase-native TOTP path. The Supabase JWT carries `aal: "aal2"` plus
 *      an `amr` array; we check the most recent `totp`/`webauthn` entry's
 *      timestamp.
 *   2. App-issued passkey attestation cookie (`autoflow_aal2_attestation`).
 *      Supabase doesn't expose a WebAuthn factor, so after we verify a
 *      passkey assertion server-side we mint a short-lived JWT (signed with
 *      APP_JWT_SECRET) that carries `{ sub, method: "webauthn", iat, exp }`.
 *      requireAAL2 accepts it iff `sub === req.auth.sub` and it's unexpired.
 *
 * Failures return 401 with `{ error: "mfa_step_up_required", reason }` so the
 * frontend's global response interceptor can pop a step-up modal.
 */

import type { NextFunction, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { resolveAppJwtConfig } from "../auth/appAuthTokens";
import {
  REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  isWorkspaceFlagEnabled,
} from "../security/workspaceFeatureFlags";

export const AAL2_ATTESTATION_COOKIE = "autoflow_aal2_attestation";
export const AAL2_ATTESTATION_AUDIENCE = "autoflow-aal2";
export const AAL2_ATTESTATION_ISSUER = "autoflow-mfa";

const DEFAULT_STEP_UP_TTL_SECONDS = 15 * 60;

function getStepUpTtlSeconds(): number {
  const raw = process.env.MFA_STEP_UP_TTL_SECONDS;
  if (!raw) return DEFAULT_STEP_UP_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STEP_UP_TTL_SECONDS;
  return parsed;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface Aal2AttestationClaims extends JwtPayload {
  sub: string;
  method: "webauthn" | "totp" | "recovery_code";
}

export interface VerifyAal2AttestationResult {
  valid: boolean;
  claims?: Aal2AttestationClaims;
  reason?: string;
}

export function verifyAal2AttestationCookie(
  cookieValue: string,
  expectedUserId: string,
): VerifyAal2AttestationResult {
  const config = resolveAppJwtConfig();
  if (!config) {
    return { valid: false, reason: "app_jwt_not_configured" };
  }
  try {
    const decoded = jwt.verify(cookieValue, config.secret, {
      audience: AAL2_ATTESTATION_AUDIENCE,
      issuer: AAL2_ATTESTATION_ISSUER,
    }) as Aal2AttestationClaims;
    if (!decoded.sub || decoded.sub !== expectedUserId) {
      return { valid: false, reason: "subject_mismatch" };
    }
    if (decoded.method !== "webauthn" && decoded.method !== "totp" && decoded.method !== "recovery_code") {
      return { valid: false, reason: "invalid_method" };
    }
    return { valid: true, claims: decoded };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.name : "attestation_invalid",
    };
  }
}

function extractAttestationCookie(req: AuthenticatedRequest): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || !raw) return null;
  const parts = raw.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== AAL2_ATTESTATION_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    return value || null;
  }
  return null;
}

function checkSupabaseAal2(req: AuthenticatedRequest, ttlSeconds: number): VerifyAal2AttestationResult {
  if (req.auth?.aal !== "aal2") {
    return { valid: false, reason: "aal_below_two" };
  }
  const amr = req.auth.amr ?? [];
  if (amr.length === 0) {
    return { valid: false, reason: "no_amr_entries" };
  }
  const mfaMethods = new Set(["totp", "webauthn", "phone"]);
  const recent = amr
    .filter((entry) => mfaMethods.has(entry.method))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) {
    return { valid: false, reason: "no_mfa_amr_entry" };
  }
  const age = nowSeconds() - recent.timestamp;
  if (age > ttlSeconds) {
    return { valid: false, reason: "mfa_expired" };
  }
  return { valid: true };
}

/**
 * Test-mode bypass via `MFA_DISABLE_AAL2_ENFORCEMENT=true`. Set in
 * `jest.env.cjs` so the dozens of pre-existing tests that mock
 * `requireAuth` and don't know about AAL2 keep working without each having
 * to stub `requireAAL2` separately. The MFA-specific tests in
 * `src/middleware/requireAAL2.test.ts`, `src/security/mfaService.test.ts`,
 * and `src/admin/staffAuth.test.ts` explicitly delete this env var in
 * their beforeEach so the real gate behavior is still verified.
 *
 * Production cannot trip this: the env var isn't set in any Infisical env,
 * and even if it were, app boot doesn't run with NODE_ENV=test.
 */
function isAal2EnforcementDisabled(): boolean {
  return process.env.MFA_DISABLE_AAL2_ENFORCEMENT === "true";
}

/**
 * HEL-280 / HEL-305: OAuth sign-ins are accepted as AAL2 because Google +
 * GitHub enforce phishing-resistant 2FA on their side. An enterprise
 * workspace can flip this back off via the
 * `require_app_mfa_for_oauth_users` workspace feature override.
 *
 * HEL-305: this used to read `req.auth.provider` (sourced from Supabase's
 * `app_metadata.provider`), but that column is the SIGNUP IdP, not the
 * current session's IdP. A user who signed up via email and later linked
 * Google sees `provider = "email"` forever, even when their current
 * session was minted via Google. The session AMR claim — populated by
 * Supabase per sign-in with `{method: "oauth"}` for any OAuth provider —
 * is the right signal. Whitelisted-IdP enforcement happens at the
 * Supabase project config layer (only Google + GitHub are enabled).
 *
 * If the request isn't workspace-scoped (no `workspaceId` claim), we
 * default to trusting the IdP — the workspace-scoped override only
 * makes sense when there's a workspace to scope to.
 */
async function checkOauthShortcut(req: AuthenticatedRequest): Promise<boolean> {
  const amr = req.auth?.amr ?? [];
  const hasOauthAmr = amr.some((entry) => entry.method === "oauth");
  if (!hasOauthAmr) return false;
  const workspaceId = req.auth?.workspaceId;
  if (!workspaceId) return true;
  const overrideOn = await isWorkspaceFlagEnabled(
    workspaceId,
    req.auth?.sub,
    REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  );
  return !overrideOn;
}

async function requireAAL2Impl(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth?.sub) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (isAal2EnforcementDisabled()) {
    next();
    return;
  }
  const ttl = getStepUpTtlSeconds();

  const supabaseCheck = checkSupabaseAal2(req, ttl);
  if (supabaseCheck.valid) {
    next();
    return;
  }

  if (await checkOauthShortcut(req)) {
    next();
    return;
  }

  const cookie = extractAttestationCookie(req);
  if (cookie) {
    const cookieCheck = verifyAal2AttestationCookie(cookie, req.auth.sub);
    if (cookieCheck.valid) {
      next();
      return;
    }
    res.status(401).json({
      error: "mfa_step_up_required",
      reason: cookieCheck.reason ?? supabaseCheck.reason ?? "step_up_required",
    });
    return;
  }

  res.status(401).json({
    error: "mfa_step_up_required",
    reason: supabaseCheck.reason ?? "step_up_required",
  });
}

/**
 * HEL-298: `requireAAL2Impl` is async because HEL-280 introduced an
 * await on `isWorkspaceFlagEnabled`. Express 4 doesn't route rejections
 * from a raw async middleware through the error handler — the request
 * hangs until the client times out (same class of bug as HEL-183/184).
 * Wrapping at the export keeps every callsite (`app.use(..., requireAAL2, ...)`)
 * unchanged while routing rejections through `next(err)`. After the
 * Express 5 upgrade this wrapper becomes a no-op — keep it anyway for
 * stable shape.
 *
 * The wrapper returns the underlying Promise so test code can still
 * `await requireAAL2(...)`. Express ignores the return value; the
 * `.catch(next)` is what guarantees rejections reach error middleware.
 */
export const requireAAL2: (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => Promise<void> = (req, res, next) => {
  return requireAAL2Impl(req, res, next).catch((err) => {
    next(err);
  });
};

export interface MintAal2AttestationInput {
  userId: string;
  method: "webauthn" | "totp" | "recovery_code";
  ttlSeconds?: number;
}

export interface MintedAal2Attestation {
  token: string;
  expiresAt: number;
  maxAgeSeconds: number;
}

export function mintAal2Attestation(
  input: MintAal2AttestationInput,
): MintedAal2Attestation {
  const config = resolveAppJwtConfig();
  if (!config) {
    throw new Error("APP_JWT_SECRET must be configured to mint AAL2 attestations");
  }
  const ttl = input.ttlSeconds ?? getStepUpTtlSeconds();
  const issuedAt = nowSeconds();
  const expiresAt = issuedAt + ttl;
  const token = jwt.sign(
    {
      sub: input.userId,
      method: input.method,
      iat: issuedAt,
      exp: expiresAt,
    },
    config.secret,
    {
      audience: AAL2_ATTESTATION_AUDIENCE,
      issuer: AAL2_ATTESTATION_ISSUER,
    },
  );
  return {
    token,
    expiresAt,
    maxAgeSeconds: ttl,
  };
}

export function buildAal2AttestationCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${AAL2_ATTESTATION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function buildAal2AttestationClearCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${AAL2_ATTESTATION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
