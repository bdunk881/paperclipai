/**
 * JWT verification middleware for Microsoft Entra External ID (CIAM).
 *
 * Validates Bearer tokens issued by the Entra External ID tenant using the
 * tenant's public JWKS endpoint.  No Azure SDK required — just standard
 * OIDC/JWT verification via jwks-rsa + jsonwebtoken.
 *
 * Required env vars:
 *   AZURE_TENANT_SUBDOMAIN  — e.g. "myapp" → myapp.ciamlogin.com
 *   AZURE_TENANT_ID         — Directory (tenant) ID (GUID)
 *   AZURE_CLIENT_ID         — App registration client ID (used as audience)
 */

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

const tenantSubdomain = process.env.AZURE_TENANT_SUBDOMAIN;
const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;

if (!tenantSubdomain || !tenantId || !clientId) {
  console.warn(
    "[auth] AZURE_TENANT_SUBDOMAIN, AZURE_TENANT_ID, or AZURE_CLIENT_ID is not set. " +
      "JWT verification middleware will reject all requests."
  );
}

// JWKS endpoint for Entra External ID CIAM tenants
const jwksUri = tenantSubdomain && tenantId
  ? `https://${tenantSubdomain}.ciamlogin.com/${tenantId}/discovery/v2.0/keys`
  : "";

const jwksClient = jwksRsa({
  jwksUri: jwksUri || "https://placeholder.ciamlogin.com/placeholder/discovery/v2.0/keys",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes
});

function getSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
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
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const token = authHeader.slice(7);

  if (!jwksUri) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  jwt.verify(
    token,
    getSigningKey,
    {
      audience: clientId,
      issuer: `https://${tenantSubdomain}.ciamlogin.com/${tenantId}/v2.0`,
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err || !decoded) {
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
