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

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

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
  if (process.env.QA_AUTH_BYPASS_ENABLED !== "true") {
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
  const isDashboardPreviewReadRoute =
    req.method === "GET" &&
    (
      requestPath === "/api/runs" ||
      requestPath.startsWith("/api/runs/") ||
      requestPath === "/api/llm-configs"
    );
  const allowHeaderAuth = isMemoryRoute || isKnowledgeRoute || isDashboardPreviewReadRoute;
  if (!authHeader?.startsWith("Bearer ")) {
    if (allowHeaderAuth && typeof headerUserId === "string" && headerUserId.trim()) {
      req.auth = { sub: headerUserId.trim() };
      next();
      return;
    }
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const token = authHeader.slice(7);
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
        const tokenClaims = decodeJwtDiagnosticClaims(token);
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
  const qaBypassUserId = resolveQaBypassUserId(req);
  if (qaBypassUserId) {
    attachQaBypassAuth(req, qaBypassUserId);
    next();
    return;
  }

  requireAuth(req, res, next);
}
