/**
 * JWT verification middleware for authenticated API callers.
 *
 * Accepts:
 * - Local app-issued JWTs used by the legacy social-auth bridge
 * - Supabase Auth access tokens verified against the project's JWKS
 */

import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { recordControlPlaneAudit, resolveAuditWorkspaceIdForUser } from "../auditing/controlPlaneAudit";
import { isQaBypassEnabledByName } from "../security/qaBypassGuard";
import { resolveAppJwtConfig, verifyAppUserTokenWithDiagnostics } from "./appAuthTokens";
import { resolveSupabaseAuthConfig, verifySupabaseTokenWithDiagnostics } from "./supabaseAuth";

type JwtDiagnosticClaims = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
};

function decodeJwtDiagnosticClaims(token: string): JwtDiagnosticClaims | null {
  const [, rawPayload] = token.split(".");
  if (!rawPayload) {
    return null;
  }

  try {
    const normalized = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;

    return {
      aud:
        typeof parsed.aud === "string" || Array.isArray(parsed.aud)
          ? (parsed.aud as string | string[])
          : undefined,
      iss: typeof parsed.iss === "string" ? parsed.iss : undefined,
      exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
      nbf: typeof parsed.nbf === "number" ? parsed.nbf : undefined,
    };
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (Array.isArray(value)) {
    const match = value.find((entry) => typeof entry === "string" && entry.trim());
    return typeof match === "string" ? match : undefined;
  }

  return undefined;
}

export interface AuthenticatedRequest extends Request {
  auth?: {
    sub: string;
    email?: string;
    name?: string;
    tenantId?: string;
    oid?: string;
    provider?: string;
    issuer?: string;
  };
}

const DEFAULT_QA_BYPASS_USER_IDS = ["qa-smoke-user"];

function parseQaBypassUserIds(): Set<string> {
  const configuredIds = (process.env.QA_AUTH_BYPASS_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const userIds = configuredIds.length > 0 ? configuredIds : DEFAULT_QA_BYPASS_USER_IDS;
  return new Set(userIds);
}

function resolveQaBypassUserId(req: Request): string | null {
  // Routed through qaBypassGuard so the production-boot guard sees a single
  // source of truth and so this gate refuses the bypass when NODE_ENV is
  // "production" (or absent), regardless of the env var value.
  if (!isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED")) {
    return null;
  }

  const headerValue = req.headers["x-user-id"];
  const userId = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!userId) {
    return null;
  }

  return parseQaBypassUserIds().has(userId) ? userId : null;
}

function attachQaBypassAuth(req: AuthenticatedRequest, userId: string): void {
  req.auth = {
    sub: userId,
    name: "QA bypass user",
  };
}

function queueQaBypassAudit(
  req: Request,
  userId: string,
  outcome: "allowed" | "denied",
  reason: "allowlisted" | "not_allowlisted" | "disabled" | "missing_user_id"
): void {
  const requestPath = (req.originalUrl || req.path).split("?")[0];
  const explicitWorkspaceId =
    typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"].trim() : null;

  void (async () => {
    const workspaceId = await resolveAuditWorkspaceIdForUser(userId, explicitWorkspaceId);
    if (!workspaceId) {
      return;
    }

    await recordControlPlaneAudit({
      workspaceId,
      userId,
      category: "bypass_attempt",
      action: "qa_auth_bypass_attempt",
      target: { type: "user", id: userId },
      metadata: {
        outcome,
        reason,
        method: req.method,
        path: requestPath,
      },
    });

    if (outcome === "allowed") {
      await recordControlPlaneAudit({
        workspaceId,
        userId,
        category: "auth",
        action: "qa_auth_bypass_authenticated",
        target: { type: "user", id: userId },
        metadata: {
          method: req.method,
          path: requestPath,
        },
      });
    }
  })();
}

function attachSupabaseAuth(req: AuthenticatedRequest, claims: JwtPayload): void {
  const appMetadata = claims.app_metadata as Record<string, unknown> | undefined;
  const userMetadata = claims.user_metadata as Record<string, unknown> | undefined;

  req.auth = {
    sub: String(claims.sub),
    email: firstString(claims.email) ?? firstString(claims.phone),
    name:
      firstString(userMetadata?.full_name) ??
      firstString(userMetadata?.name) ??
      firstString(claims.email) ??
      firstString(claims.phone),
    provider: firstString(appMetadata?.provider) ?? "supabase",
    issuer: firstString(claims.iss),
  };
}

/**
 * Express middleware that validates the Authorization: Bearer <token> header.
 * Attaches `req.auth` on success; responds 401 on failure.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const headerUserId = req.headers["x-user-id"];
  const requestPath = (req.originalUrl || req.path).split("?")[0];
  const isMemoryRoute = requestPath === "/api/memory" || requestPath.startsWith("/api/memory/");
  const isKnowledgeRoute = requestPath === "/api/knowledge" || requestPath.startsWith("/api/knowledge/");
  const isIntegrationsRoute =
    requestPath === "/api/integrations" || requestPath.startsWith("/api/integrations/");
  const isDashboardPreviewReadRoute =
    req.method === "GET" &&
    (requestPath === "/api/runs" ||
      requestPath.startsWith("/api/runs/") ||
      requestPath === "/api/llm-configs");
  const allowHeaderAuth = isMemoryRoute || isKnowledgeRoute || isDashboardPreviewReadRoute;

  if (!authHeader?.startsWith("Bearer ")) {
    const qaBypassUserId = isIntegrationsRoute ? resolveQaBypassUserId(req) : null;
    if (qaBypassUserId) {
      queueQaBypassAudit(req, qaBypassUserId, "allowed", "allowlisted");
      attachQaBypassAuth(req, qaBypassUserId);
      next();
      return;
    }

    const attemptedUserId = typeof headerUserId === "string" ? headerUserId.trim() : "";
    if (isIntegrationsRoute && attemptedUserId) {
      queueQaBypassAudit(
        req,
        attemptedUserId,
        "denied",
        isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED") ? "not_allowlisted" : "disabled"
      );
    }

    if (allowHeaderAuth && typeof headerUserId === "string" && headerUserId.trim()) {
      req.auth = { sub: headerUserId.trim() };
      next();
      return;
    }

    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const token = authHeader.slice(7);
  const appAuthConfig = resolveAppJwtConfig();
  const supabaseAuthConfig = resolveSupabaseAuthConfig();
  const tokenClaims = decodeJwtDiagnosticClaims(token);

  if (appAuthConfig) {
    const { claims: appClaims, errorMessage } = verifyAppUserTokenWithDiagnostics(token);
    if (appClaims?.sub) {
      req.auth = {
        sub: appClaims.sub,
        email: appClaims.email,
        name: appClaims.name,
        provider: appClaims.provider,
        issuer: appClaims.iss,
      };

      next();
      return;
    }

    const looksLikeAppToken =
      tokenClaims?.iss === appAuthConfig.issuer ||
      tokenClaims?.aud === appAuthConfig.audience ||
      (Array.isArray(tokenClaims?.aud) && tokenClaims.aud.includes(appAuthConfig.audience));

    if (looksLikeAppToken) {
      console.warn("[auth] App JWT verification failed", {
        errMessage: errorMessage,
        tokenAud: tokenClaims?.aud,
        tokenIss: tokenClaims?.iss,
        tokenExp: tokenClaims?.exp,
        tokenNbf: tokenClaims?.nbf,
        expectedAudience: appAuthConfig.audience,
        expectedIssuer: appAuthConfig.issuer,
      });
      res.status(401).json({ error: "Invalid or expired token." });
      return;
    }
  }

  if (!supabaseAuthConfig) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  void verifySupabaseTokenWithDiagnostics(token)
    .then(({ claims, errorMessage, errorName }) => {
      if (!claims?.sub) {
        console.warn("[auth] Supabase JWT verification failed", {
          errName: errorName,
          errMessage: errorMessage,
          tokenAud: tokenClaims?.aud,
          tokenIss: tokenClaims?.iss,
          tokenExp: tokenClaims?.exp,
          tokenNbf: tokenClaims?.nbf,
          expectedAudiences: supabaseAuthConfig.audiences,
          expectedIssuer: supabaseAuthConfig.issuer,
          jwksUri: supabaseAuthConfig.jwksUri,
        });
        res.status(401).json({ error: "Invalid or expired token." });
        return;
      }

      attachSupabaseAuth(req, claims);
      next();
    })
    .catch((error: unknown) => {
      console.warn("[auth] Supabase JWT verification failed", {
        errName: error instanceof Error ? error.name : "UnknownError",
        errMessage: error instanceof Error ? error.message : "Unknown token verification error.",
        tokenAud: tokenClaims?.aud,
        tokenIss: tokenClaims?.iss,
        tokenExp: tokenClaims?.exp,
        tokenNbf: tokenClaims?.nbf,
        expectedAudiences: supabaseAuthConfig.audiences,
        expectedIssuer: supabaseAuthConfig.issuer,
        jwksUri: supabaseAuthConfig.jwksUri,
      });
      res.status(401).json({ error: "Invalid or expired token." });
    });
}

/**
 * Allows staging QA verification to authenticate with X-User-Id when the
 * bypass is explicitly enabled and the caller is on the allowlist.
 */
export function requireAuthOrQaBypass(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const headerValue = req.headers["x-user-id"];
  const attemptedUserId = typeof headerValue === "string" ? headerValue.trim() : "";
  const bypassEnabled = isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED");
  const qaBypassUserId = resolveQaBypassUserId(req);
  if (qaBypassUserId) {
    queueQaBypassAudit(req, qaBypassUserId, "allowed", "allowlisted");
    attachQaBypassAuth(req, qaBypassUserId);
    next();
    return;
  }

  if (attemptedUserId) {
    queueQaBypassAudit(
      req,
      attemptedUserId,
      "denied",
      bypassEnabled ? "not_allowlisted" : "disabled"
    );
  }

  requireAuth(req, res, next);
}
