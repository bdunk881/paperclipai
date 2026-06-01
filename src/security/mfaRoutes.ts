/**
 * HTTP routes for the MFA flows (HEL-mfa).
 *
 * Mounted at `/api/mfa` (user-scoped, no workspace required). Internally
 * the service layer resolves a workspace from `x-workspace-id` for audit
 * logging when one is available — but enrollment and step-up must work
 * even for users with no active workspace yet.
 *
 *   GET    /api/mfa/policy                      — list factors + recovery code status
 *   POST   /api/mfa/webauthn/register/options   — begin passkey registration
 *   POST   /api/mfa/webauthn/register/verify    — complete passkey registration
 *   POST   /api/mfa/webauthn/auth/options       — begin passkey assertion (step-up or login)
 *   POST   /api/mfa/webauthn/auth/verify        — complete passkey assertion → AAL2 cookie
 *   DELETE /api/mfa/webauthn/:credentialId      — remove a passkey (requires AAL2)
 *   POST   /api/mfa/totp/enroll                 — begin TOTP enrollment via Supabase
 *   POST   /api/mfa/totp/verify                 — verify the TOTP enrollment code
 *   DELETE /api/mfa/totp/:factorId              — remove a TOTP factor (requires AAL2)
 *   POST   /api/mfa/recovery-codes/regenerate   — issue fresh recovery codes (requires AAL2)
 *   POST   /api/mfa/recovery-codes/consume      — one-time fallback verify → AAL2 cookie
 *   POST   /api/mfa/email-otp/enroll/begin      — HEL-282: send enrollment code
 *   POST   /api/mfa/email-otp/enroll/verify     — HEL-282: verify code → enroll + AAL2 cookie
 *   POST   /api/mfa/email-otp/challenge         — HEL-282: step-up: send code
 *   POST   /api/mfa/email-otp/verify            — HEL-282: step-up: verify code → AAL2 cookie
 *   DELETE /api/mfa/email-otp                   — HEL-282: disable email-OTP (requires AAL2)
 *   POST   /api/mfa/magic-link/enroll/begin     — HEL-282: email an enrollment link
 *   POST   /api/mfa/magic-link/challenge        — HEL-282: step-up: email a verify link
 *   DELETE /api/mfa/magic-link                  — HEL-282: disable magic-link (requires AAL2)
 *   GET    /api/mfa/magic-link/verify?token=…   — HEL-282: PUBLIC (mounted in app.ts) → AAL2 cookie + redirect
 *
 * Routes that grant AAL2 set `autoflow_aal2_attestation` as an HttpOnly,
 * Secure (in prod), SameSite=Strict cookie scoped to /.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  buildAal2AttestationCookieHeader,
  requireAAL2,
} from "../middleware/requireAAL2";
import { SecurityServiceError } from "./securityService";
import { getMfaService, type MfaService, type MfaServiceContext } from "./mfaService";

function buildContext(req: AuthenticatedRequest): MfaServiceContext {
  const workspaceHeader = req.headers["x-workspace-id"];
  const workspaceId =
    typeof workspaceHeader === "string" && workspaceHeader.trim()
      ? workspaceHeader.trim()
      : undefined;
  const userAgent =
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ??
    req.ip ??
    req.socket?.remoteAddress ??
    undefined;
  return {
    workspaceId,
    userId: req.auth!.sub,
    userAgent,
    ip,
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof SecurityServiceError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      // HEL-282: merge structured fields (e.g. retryAfterSeconds on a 429).
      ...(error.details ?? {}),
    });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown MFA error";
  console.warn("[mfaRoutes]", message);
  res.status(500).json({ error: "MFA operation failed", code: "mfa_error" });
}

function extractAccessToken(req: AuthenticatedRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function setAttestationCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const existing = res.getHeader("Set-Cookie");
  const header = buildAal2AttestationCookieHeader(token, maxAgeSeconds);
  if (!existing) {
    res.setHeader("Set-Cookie", header);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, header]);
  } else {
    res.setHeader("Set-Cookie", [String(existing), header]);
  }
}

const registerVerifySchema = z.object({
  response: z.unknown(),
  deviceName: z.string().trim().max(120).optional(),
});

const authVerifySchema = z.object({
  response: z.unknown(),
  credentialId: z.string().min(1, "credentialId is required"),
});

const totpEnrollSchema = z.object({
  friendlyName: z.string().trim().min(1).max(120),
});

const totpVerifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, "TOTP code must be 6 digits"),
});

const recoveryConsumeSchema = z.object({
  code: z.string().min(8),
});

const recoveryResetPasswordSchema = z.object({
  code: z.string().min(8),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

const accountResetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// HEL-282: email-OTP code is exactly 6 digits.
const emailOtpVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

/**
 * HEL-282: the verified email the OTP/magic-link is sent to. Mirrors the
 * WebAuthn route's fallback so a brand-new user with no email claim still
 * resolves to a deterministic address (dev/test only — real users always
 * carry an email claim).
 */
function resolveUserEmail(req: AuthenticatedRequest): string {
  return req.auth?.email ?? `${req.auth!.sub}@autoflow.local`;
}

export function createMfaRoutes(service: MfaService = getMfaService()): Router {
  const router = Router();

  router.get(
    "/policy",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        // HEL-280 / HEL-305: thread the provider hint AND the session
        // amr so the service can decide OAuth-vs-password from the
        // per-session signal. Provider alone is the signup IdP and
        // would misclassify users who signed up via email and later
        // linked Google.
        res.json(
          await service.getPolicy(buildContext(req), {
            provider: req.auth?.provider,
            amr: req.auth?.amr,
          }),
        );
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- WebAuthn registration --------------------------------------------
  router.post(
    "/webauthn/register/options",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const email = req.auth?.email ?? `${req.auth!.sub}@autoflow.local`;
        const options = await service.beginWebauthnRegistration(buildContext(req), email);
        res.json(options);
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/webauthn/register/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = registerVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        const { credentialId, attestation } = await service.finishWebauthnRegistration(
          buildContext(req),
          parsed.data.response,
          parsed.data.deviceName,
        );
        // HEL-338: passkey registration grants AAL2 (parity with auth verify /
        // TOTP enroll) so the next admin request isn't 401 mfa_step_up_required.
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.status(201).json({ credentialId, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- WebAuthn authentication (step-up + login challenge) --------------
  router.post(
    "/webauthn/auth/options",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const options = await service.beginWebauthnAuthentication(buildContext(req));
        res.json(options);
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/webauthn/auth/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = authVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        const { attestation } = await service.finishWebauthnAuthentication(
          buildContext(req),
          parsed.data.response,
          parsed.data.credentialId,
        );
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.json({ verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.delete(
    "/webauthn/:credentialId",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        await service.removeWebauthnCredential(buildContext(req), req.params.credentialId);
        res.status(204).send();
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- TOTP -------------------------------------------------------------
  router.post(
    "/totp/enroll",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = totpEnrollSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      const accessToken = extractAccessToken(req);
      if (!accessToken) {
        res.status(401).json({ error: "Bearer token required" });
        return;
      }
      try {
        const enrolled = await service.beginTotpEnrollment(
          buildContext(req),
          accessToken,
          parsed.data.friendlyName,
        );
        res.json(enrolled);
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/totp/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = totpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      const accessToken = extractAccessToken(req);
      if (!accessToken) {
        res.status(401).json({ error: "Bearer token required" });
        return;
      }
      try {
        const { attestation } = await service.finishTotpEnrollment(
          buildContext(req),
          accessToken,
          parsed.data.factorId,
          parsed.data.code,
        );
        // HEL-331: TOTP enrollment-verify grants AAL2 (parity with email-OTP
        // enroll) so the immediately-following recovery-code issuance — and any
        // step-up — is satisfied without bouncing to a passkey-only modal.
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.status(201).json({ enrolled: true, verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // HEL-335: step-up using an existing verified TOTP factor → AAL2 cookie.
  // Distinct from /totp/verify (which finalizes a fresh enrollment).
  router.post(
    "/totp/step-up/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = emailOtpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      const accessToken = extractAccessToken(req);
      if (!accessToken) {
        res.status(401).json({ error: "Bearer token required" });
        return;
      }
      try {
        const { attestation } = await service.verifyTotpStepUp(
          buildContext(req),
          accessToken,
          parsed.data.code,
        );
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.json({ verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.delete(
    "/totp/:factorId",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const accessToken = extractAccessToken(req);
      if (!accessToken) {
        res.status(401).json({ error: "Bearer token required" });
        return;
      }
      try {
        await service.removeTotpFactor(buildContext(req), accessToken, req.params.factorId);
        res.status(204).send();
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- Recovery codes ---------------------------------------------------
  router.post(
    "/recovery-codes/regenerate",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const result = await service.issueRecoveryCodes(buildContext(req));
        res.status(201).json(result);
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/recovery-codes/consume",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = recoveryConsumeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        const { attestation } = await service.consumeRecoveryCode(buildContext(req), parsed.data.code);
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.json({ verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // Lost-device password reset. NOT behind requireAAL2: the recovery session
  // is aal1 by definition, and gotrue won't let it set a password when a
  // verified factor exists. The recovery code is the second factor here, and
  // the password is set out-of-band via the admin API inside the service.
  router.post(
    "/recovery-codes/reset-password",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = recoveryResetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        await service.resetPasswordWithRecoveryCode(
          buildContext(req),
          parsed.data.code,
          parsed.data.newPassword,
        );
        res.json({ ok: true });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // Factor-agnostic password reset for any already-proven AAL2 session.
  // Gated by requireAAL2, which accepts the app-owned attestation cookie a
  // passkey / email-OTP / magic-link verify just minted — so the recovery
  // page can step up with a passkey and then set the password out-of-band
  // (the recovery session itself is aal1, which gotrue's updateUser rejects).
  router.post(
    "/account/reset-password",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = accountResetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        await service.setPasswordForCurrentUser(buildContext(req), parsed.data.newPassword);
        res.json({ ok: true });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- Email OTP (HEL-282) ----------------------------------------------
  router.post(
    "/email-otp/enroll/begin",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await service.beginEmailOtpEnrollment(buildContext(req), resolveUserEmail(req)));
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/email-otp/enroll/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = emailOtpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        const { attestation } = await service.verifyEmailOtpEnrollment(buildContext(req), parsed.data.code);
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.status(201).json({ enrolled: true, verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/email-otp/challenge",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await service.challengeEmailOtp(buildContext(req), resolveUserEmail(req)));
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/email-otp/verify",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const parsed = emailOtpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });
        return;
      }
      try {
        const { attestation } = await service.verifyEmailOtp(buildContext(req), parsed.data.code);
        setAttestationCookie(res, attestation.token, attestation.maxAgeSeconds);
        res.json({ verified: true, expiresAt: attestation.expiresAt });
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.delete(
    "/email-otp",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        await service.removeEmailOtp(buildContext(req));
        res.status(204).send();
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  // ---- Magic link (HEL-282) ---------------------------------------------
  // The verify step (GET /api/mfa/magic-link/verify?token=…) is mounted as a
  // PUBLIC route in app.ts — it's clicked from an email and carries no bearer
  // token, so it can't live behind this router's requireAuth mount.
  router.post(
    "/magic-link/enroll/begin",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await service.beginMagicLinkEnrollment(buildContext(req), resolveUserEmail(req)));
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.post(
    "/magic-link/challenge",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await service.challengeMagicLink(buildContext(req), resolveUserEmail(req)));
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  router.delete(
    "/magic-link",
    requireAAL2,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        await service.removeMagicLink(buildContext(req));
        res.status(204).send();
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  return router;
}

export default createMfaRoutes();
