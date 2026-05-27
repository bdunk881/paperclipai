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
    res.status(error.statusCode).json({ error: error.message, code: error.code });
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

export function createMfaRoutes(service: MfaService = getMfaService()): Router {
  const router = Router();

  router.get(
    "/policy",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await service.getPolicy(buildContext(req)));
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
        const result = await service.finishWebauthnRegistration(
          buildContext(req),
          parsed.data.response,
          parsed.data.deviceName,
        );
        res.status(201).json(result);
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
        await service.finishTotpEnrollment(
          buildContext(req),
          accessToken,
          parsed.data.factorId,
          parsed.data.code,
        );
        res.status(201).json({ enrolled: true });
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

  return router;
}

export default createMfaRoutes();
