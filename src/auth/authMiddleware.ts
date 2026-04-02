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
 *
 * RBAC roles (mapped to Azure Entra app roles in the app manifest):
 *   Viewer   — read-only access to own runs and approvals
 *   Operator — Viewer + trigger runs, resolve approvals
 *   Admin    — Operator + configuration management (LLM configs, etc.)
 */

import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import { logSecurityEvent } from "./securityLogger";

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

/** Role values that map 1:1 to the Azure Entra app manifest appRoles[].value. */
export type Role = "Viewer" | "Operator" | "Admin";

export interface AuthenticatedRequest extends Request {
  auth?: {
    sub: string;
    email?: string;
    name?: string;
    tenantId?: string;
    oid?: string;
    /** App roles extracted from the `roles` claim in the Entra JWT. */
    roles: Role[];
  };
}

/**
 * Express middleware that validates the Authorization: Bearer <token> header.
 * Attaches `req.auth` on success; responds 401 on failure.
 * Emits structured JSON security events for all auth outcomes.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    logSecurityEvent("auth_failure", { reason: "missing_or_malformed_header" }, req);
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const token = authHeader.slice(7);

  if (!jwksUri) {
    logSecurityEvent("auth_failure", { reason: "auth_service_not_configured" }, req);
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
        logSecurityEvent("auth_failure", {
          reason: "invalid_or_expired_token",
          error: err?.message,
        }, req);
        res.status(401).json({ error: "Invalid or expired token." });
        return;
      }

      const claims = decoded as JwtPayload;
      const rawRoles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
      const validRoles: Role[] = ["Viewer", "Operator", "Admin"];
      req.auth = {
        sub: claims.sub as string,
        email: claims.email as string | undefined,
        name: claims.name as string | undefined,
        tenantId: claims.tid as string | undefined,
        oid: claims.oid as string | undefined,
        roles: rawRoles.filter((r): r is Role => validRoles.includes(r as Role)),
      };

      logSecurityEvent("auth_success", { sub: req.auth.sub, roles: req.auth.roles }, req);
      next();
    }
  );
}

/**
 * Middleware factory that enforces role-based access control.
 * The caller must have at least one of the specified roles.
 *
 * Must be used after `requireAuth` so that `req.auth` is populated.
 *
 * @example
 *   app.post("/api/runs", requireAuth, requireRole("Operator", "Admin"), handler)
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const userRoles = req.auth?.roles ?? [];
    const hasRole = allowedRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      logSecurityEvent("authz_failure", {
        sub: req.auth?.sub,
        required_roles: allowedRoles,
        actual_roles: userRoles,
      }, req);
      res.status(403).json({ error: "Insufficient permissions." });
      return;
    }
    next();
  };
}
