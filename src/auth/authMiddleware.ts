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
  tenantSubdomain: string;
  tenantId: string;
  clientId: string;
  jwksUri: string;
  issuer: string;
};

const jwksClientCache = new Map<string, jwksRsa.JwksClient>();
let missingConfigWarningLogged = false;

function resolveAuthConfig(): AuthConfig | null {
  const tenantSubdomain = process.env.AZURE_CIAM_TENANT_SUBDOMAIN ?? process.env.AZURE_TENANT_SUBDOMAIN;
  const tenantId = process.env.AZURE_CIAM_TENANT_ID ?? process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CIAM_CLIENT_ID ?? process.env.AZURE_CLIENT_ID;

  if (!tenantSubdomain || !tenantId || !clientId) {
    if (!missingConfigWarningLogged) {
      console.warn(
        "[auth] CIAM auth env is incomplete. Expected AZURE_CIAM_* vars, " +
          "with legacy fallback to AZURE_TENANT_SUBDOMAIN/AZURE_TENANT_ID/AZURE_CLIENT_ID."
      );
      missingConfigWarningLogged = true;
    }
    return null;
  }

  const normalizedSubdomain = tenantSubdomain.trim();
  const normalizedTenantId = tenantId.trim();
  const normalizedClientId = clientId.trim();

  return {
    tenantSubdomain: normalizedSubdomain,
    tenantId: normalizedTenantId,
    clientId: normalizedClientId,
    jwksUri: `https://${normalizedSubdomain}.ciamlogin.com/${normalizedTenantId}/discovery/v2.0/keys`,
    issuer: `https://${normalizedSubdomain}.ciamlogin.com/${normalizedTenantId}/v2.0`,
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
  const allowHeaderAuth = isMemoryRoute || isKnowledgeRoute;
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
      audience: authConfig.clientId,
      issuer: authConfig.issuer,
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
