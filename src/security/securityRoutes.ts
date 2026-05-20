import { Router, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  SecurityServiceError,
  securityService,
  type SecurityContext,
  type SecurityService,
} from "./securityService";

type SecurityRequest = AuthenticatedRequest & WorkspaceAwareRequest;

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(12, "New password must be at least 12 characters."),
});

function extractBearerToken(req: SecurityRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function getClientIp(req: SecurityRequest): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim();
  }
  return req.ip || req.socket?.remoteAddress || undefined;
}

function getSecurityContext(req: SecurityRequest, res: Response): SecurityContext | null {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required." });
    return null;
  }

  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "Workspace context is required." });
    return null;
  }

  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    res.status(401).json({ error: "Bearer access token is required." });
    return null;
  }

  return {
    workspaceId,
    userId,
    accessToken,
    sessionId: req.auth?.sessionId,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    ip: getClientIp(req),
  };
}

function sendSecurityError(res: Response, error: unknown): void {
  if (error instanceof SecurityServiceError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown security settings error.";
  console.warn("[securityRoutes]", message);
  res.status(500).json({ error: "Security settings operation failed.", code: "security_error" });
}

export function createSecurityRoutes(service: SecurityService = securityService) {
  const router = Router();

  router.get("/sessions", async (req: SecurityRequest, res) => {
    const ctx = getSecurityContext(req, res);
    if (!ctx) return;

    try {
      res.json(await service.listSessions(ctx));
    } catch (error) {
      sendSecurityError(res, error);
    }
  });

  router.post("/password", async (req: SecurityRequest, res) => {
    const ctx = getSecurityContext(req, res);
    if (!ctx) return;

    const parsed = updatePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid password update request." });
      return;
    }

    try {
      await service.updatePassword(ctx, parsed.data);
      res.status(204).send();
    } catch (error) {
      sendSecurityError(res, error);
    }
  });

  router.post("/sessions/revoke-others", async (req: SecurityRequest, res) => {
    const ctx = getSecurityContext(req, res);
    if (!ctx) return;

    try {
      await service.revokeOtherSessions(ctx);
      res.status(204).send();
    } catch (error) {
      sendSecurityError(res, error);
    }
  });

  router.delete("/sessions/:id", async (req: SecurityRequest, res) => {
    const ctx = getSecurityContext(req, res);
    if (!ctx) return;

    try {
      const result = await service.revokeSession(ctx, req.params.id);
      res.json(result);
    } catch (error) {
      sendSecurityError(res, error);
    }
  });

  return router;
}

export default createSecurityRoutes();
