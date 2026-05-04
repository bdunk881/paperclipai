/**
 * JWT verification middleware for Microsoft Entra External ID (CIAM).
 *
 * Validates Bearer tokens issued by the Entra External ID tenant using the
 * tenant's public JWKS endpoint.  No Azure SDK required — just standard
 * OIDC/JWT verification via jwks-rsa + jsonwebtoken.
 *
 * Required env vars:
 *   AZURE_CIAM_TENANT_SUBDOMAIN  — e.g. "myapp" → myapp.ciamlogin.com
 *   AZURE_CIAM_TENANT_ID         — CIAM Directory (tenant) ID (GUID)
 *   AZURE_CIAM_CLIENT_ID         — CIAM app registration client ID (used as audience)
 *
 * Note: These are distinct from AZURE_CLIENT_ID / AZURE_TENANT_ID which refer
 * to the infrastructure service principal (Key Vault, Storage, etc.).
 */

import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import { resolveAppJwtConfig, verifyAppUserTokenWithDiagnostics } from "./appAuthTokens";
import { recordControlPlaneAudit, resolveAuditWorkspaceIdForUser } from "../auditing/controlPlaneAudit";
import { isQaBypassEnabledByName } from "../security/qaBypassGuard";

type AuthConfig = {
  tenantId: string;
  audiences: [string, ...string[]];
  jwksUri: string;
  issuers: [string, ...string[]];
};

type JwtDiagnosticClaims = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
};

const jwksClientCache = new Map<string, jwksRsa.JwksClient>();
let missingConfigWarningLogged = false;
const CURRENT_DASHBOARD_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const CURRENT_DASHBOARD_CIAM_API_URI = `api://${CURRENT_DASHBOARD_CIAM_CLIENT_ID}`;
const LEGACY_DASHBOARD_CIAM_CLIENT_ID = "d36ce552-1a3d-4cd3-b851-beff4e3bf440";
const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
const DEFAULT_CIAM_TENANT_ID = "5e4f1080-8afc-4005-b05e-32b21e69363a";

function normalizeAuthority(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname.toLowerCase().endsWith(".ciamlogin.com")
    ) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    return pathname ? `${parsed.origin}${pathname}` : parsed.origin;
  } catch {
    return null;
  }
}

function parseDelimitedEnv(value: string | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

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

function resolveAuthConfig(): AuthConfig | null {
  const authority = normalizeAuthority(process.env.AZURE_CIAM_AUTHORITY);
  const tenantSubdomain =
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN ??
    process.env.AZURE_TENANT_SUBDOMAIN ??
    DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const tenantId =
    process.env.AZURE_CIAM_TENANT_ID ?? process.env.AZURE_TENANT_ID ?? DEFAULT_CIAM_TENANT_ID;
  const configuredAudiences = parseDelimitedEnv(process.env.AZURE_CIAM_ALLOWED_AUDIENCES);
  const clientId = process.env.AZURE_CIAM_CLIENT_ID ?? process.env.AZURE_CLIENT_ID;

  if ((!authority && !tenantSubdomain) || !tenantId) {
    if (!missingConfigWarningLogged) {
      console.warn(
        "[auth] CIAM auth env is incomplete. Expected AZURE_CIAM_AUTHORITY or AZURE_CIAM_TENANT_SUBDOMAIN, " +
          "plus AZURE_CIAM_TENANT_ID, with fallback to repo CIAM defaults and " +
          "legacy AZURE_TENANT_SUBDOMAIN/AZURE_TENANT_ID."
      );
      missingConfigWarningLogged = true;
    }
    return null;
  }

  const normalizedTenantId = tenantId.trim();
  const normalizedAudiences = new Set([
    ...configuredAudiences,
    ...(clientId ? [clientId.trim()] : []),
    CURRENT_DASHBOARD_CIAM_CLIENT_ID,
    CURRENT_DASHBOARD_CIAM_API_URI,
    LEGACY_DASHBOARD_CIAM_CLIENT_ID,
  ]);
  const audienceValues = Array.from(normalizedAudiences).filter(Boolean);
  if (audienceValues.length === 0) {
    return null;
  }

  const issuers = authority ? [`${authority}/v2.0`] : [];
  const ciamAuthority = tenantSubdomain?.trim()
    ? `https://${tenantSubdomain.trim()}.ciamlogin.com/${normalizedTenantId}`
    : null;

  if (ciamAuthority && !issuers.includes(`${ciamAuthority}/v2.0`)) {
    issuers.push(`${ciamAuthority}/v2.0`);
  }

  // Azure Entra External ID (CIAM) tokens use the tenant GUID as the
  // ciamlogin.com subdomain in the issuer claim, regardless of whether a
  // branded custom domain or a friendly tenant subdomain is configured.
  const guidCiamIssuer = `https://${normalizedTenantId}.ciamlogin.com/${normalizedTenantId}/v2.0`;
  if (!issuers.includes(guidCiamIssuer)) {
    issuers.push(guidCiamIssuer);
  }

  const jwksUri = authority
    ? `${authority}/discovery/v2.0/keys`
    : `${ciamAuthority}/discovery/v2.0/keys`;

  if (issuers.length === 0) {
    return null;
  }

  return {
    tenantId: normalizedTenantId,
    audiences: audienceValues as [string, ...string[]],
    jwksUri,
    issuers: issuers as [string, ...string[]],
  };
}

function getJwksClient(jwksUri: string): jwksRsa.JwksClient {
  const cached = jwksClientCache.get(jwksUri);
  if (cached) {
    return cached;
  }

  const client = jwksRsa({
    jwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000, // 10 minutes
  });
  jwksClientCache.set(jwksUri, client);
  return client;
}

function getSigningKey(jwksUri: string, header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  getJwksClient(jwksUri).getSigningKey(header.kid, (err, key) => {
    if (err || !key) return callback(err ?? new Error("Signing key not found"));
    callback(null, key.getPublicKey());
  });
}

export interface AuthenticatedRequest extends Request {
  auth?: {
    sub: string;
    email?: string;
    name?: string;
    tenantId?: string;
    oid?: string;
    provider?: "entra" | "google" | "facebook" | "apple";
    issuer?: string;
    workspaceId?: string;
  };
}

function resolveWorkspaceClaim(payload: JwtPayload): string | undefined {
  const directCandidates = [
    payload["workspaceId"],
    payload["workspace_id"],
    payload["extension_workspaceId"],
    payload["extension_workspace_id"],
    payload["https://autoflow.ai/workspaceId"],
    payload["https://autoflow.ai/workspace_id"],
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!/workspace(_id|Id)$/i.test(key)) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
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
  reason: "allowlisted" | "not_allowlisted" | "disabled" | "missing_user_id",
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
    (
      requestPath === "/api/runs" ||
      requestPath.startsWith("/api/runs/") ||
      requestPath === "/api/llm-configs"
    );
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
        isQaBypassEnabledByName("QA_AUTH_BYPASS_ENABLED") ? "not_allowlisted" : "disabled",
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
        workspaceId: appClaims.workspaceId,
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

  const authConfig = resolveAuthConfig();

  if (!authConfig) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  jwt.verify(
    token,
    (header, callback) => getSigningKey(authConfig.jwksUri, header, callback),
    {
      audience: authConfig.audiences,
      issuer: authConfig.issuers,
      algorithms: ["RS256"],
    },
    (err: jwt.VerifyErrors | null, decoded?: string | JwtPayload) => {
      if (err || !decoded) {
        console.warn("[auth] JWT verification failed", {
          errName: err?.name,
          errMessage: err?.message,
          tokenAud: tokenClaims?.aud,
          tokenIss: tokenClaims?.iss,
          tokenExp: tokenClaims?.exp,
          tokenNbf: tokenClaims?.nbf,
          expectedAudiences: authConfig.audiences,
          expectedIssuers: authConfig.issuers,
          jwksUri: authConfig.jwksUri,
        });
        res.status(401).json({ error: "Invalid or expired token." });
        return;
      }

      const claims = decoded as JwtPayload;
      req.auth = {
        sub: claims.sub as string,
        email: claims.email as string | undefined,
        name: claims.name as string | undefined,
        tenantId: claims.tid as string | undefined,
        oid: claims.oid as string | undefined,
        provider: "entra",
        issuer: claims.iss as string | undefined,
        workspaceId: resolveWorkspaceClaim(claims),
      };

      next();
    }
  );
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
      bypassEnabled ? "not_allowlisted" : "disabled",
    );
  }

  requireAuth(req, res, next);
}
