/**
 * Cloudflare Access JWT verification (HEL-mfa).
 *
 * Defense-in-depth for the staff admin surface. When the
 * `*.helloautoflow.com/api/admin/*` paths are wrapped by a Cloudflare Access
 * application (set up via `cloudflared` / the Zero Trust dashboard), every
 * request that reaches Fly carries a `Cf-Access-Jwt-Assertion` header
 * containing a JWT signed by Cloudflare. Verifying that JWT proves the
 * staff member already presented a FIDO2 hardware key at the CF edge —
 * before any Supabase MFA is checked inside the app.
 *
 * Two env vars enable verification:
 *   - CF_ACCESS_AUD_TAG    — the application "audience" tag from CF Zero Trust
 *   - CF_ACCESS_TEAM_DOMAIN — your team subdomain (e.g. "autoflow")
 *
 * If either is unset the middleware is a no-op (`next()` immediately) — so
 * local dev and the in-memory test environment don't have to fake CF
 * Access. Production must set both.
 *
 * The middleware also accepts requests from authenticated Fly-internal
 * jobs that don't go through CF Access (e.g. background workers calling
 * back into the API) when `CF_ACCESS_INTERNAL_BYPASS_TOKEN` is configured
 * and the request carries `X-Autoflow-Internal-Token` matching. Without
 * the bypass token, the only way past this middleware is a CF-issued JWT.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const CF_ACCESS_HEADER = "cf-access-jwt-assertion";
const CF_ACCESS_COOKIE = "CF_Authorization";
const INTERNAL_BYPASS_HEADER = "x-autoflow-internal-token";

interface CfAccessConfig {
  audienceTag: string;
  teamDomain: string;
  jwksUri: string;
}

// allowlist: process-local JWKS fetcher cache keyed by Cloudflare Access team domain
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function resolveConfig(): CfAccessConfig | null {
  const audienceTag = process.env.CF_ACCESS_AUD_TAG?.trim();
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim();
  if (!audienceTag || !teamDomain) return null;
  const normalizedDomain = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    audienceTag,
    teamDomain: normalizedDomain,
    jwksUri: `https://${normalizedDomain}.cloudflareaccess.com/cdn-cgi/access/certs`,
  };
}

function getRemoteJwks(jwksUri: string) {
  const cached = remoteJwksCache.get(jwksUri);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  remoteJwksCache.set(jwksUri, jwks);
  return jwks;
}

function extractAssertion(req: Request): string | null {
  const header = req.headers[CF_ACCESS_HEADER];
  if (typeof header === "string" && header.trim()) return header.trim();
  // Cloudflare also sets the JWT as a cookie when the request arrives at
  // a browser-fronted surface. Read it as a fallback so a curl against
  // /api/admin/* that includes the cookie also works.
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== CF_ACCESS_COOKIE) continue;
    return part.slice(idx + 1).trim() || null;
  }
  return null;
}

export interface CfAccessClaims extends JWTPayload {
  email?: string;
  identity_nonce?: string;
  country?: string;
}

export async function verifyCfAccessAssertion(
  token: string,
): Promise<{ valid: true; claims: CfAccessClaims } | { valid: false; reason: string }> {
  const config = resolveConfig();
  if (!config) return { valid: false, reason: "cf_access_not_configured" };
  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(config.jwksUri), {
      issuer: `https://${config.teamDomain}.cloudflareaccess.com`,
      audience: config.audienceTag,
    });
    return { valid: true, claims: payload as CfAccessClaims };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.name : "cf_access_verification_failed",
    };
  }
}

/**
 * Express middleware. Mount BEFORE requireAuth on /api/admin/* routes when
 * the CF Access app is configured. Skipped silently when env vars are
 * unset (local dev, test) so the existing in-memory tests keep working.
 */
export function requireCfAccess(req: Request, res: Response, next: NextFunction): void {
  const config = resolveConfig();
  if (!config) {
    // CF Access not configured — fail-open is intentional in dev/test.
    // requireStaff still gates production access via the staff allowlist +
    // AAL2 cookie inside the app.
    next();
    return;
  }

  const internalBypass = process.env.CF_ACCESS_INTERNAL_BYPASS_TOKEN?.trim();
  if (internalBypass) {
    const presented = req.headers[INTERNAL_BYPASS_HEADER];
    if (typeof presented === "string" && presented.trim() === internalBypass) {
      next();
      return;
    }
  }

  const assertion = extractAssertion(req);
  if (!assertion) {
    res.status(401).json({
      error: "cf_access_required",
      reason: "missing_assertion",
    });
    return;
  }

  void verifyCfAccessAssertion(assertion).then((result) => {
    if (!result.valid) {
      res.status(401).json({
        error: "cf_access_required",
        reason: result.reason,
      });
      return;
    }
    // Stamp the verified CF identity onto the request so audit code
    // downstream can attribute the call to the edge identity even if the
    // app's Supabase auth resolves a different user (it shouldn't — but
    // we want the forensic trail).
    (req as Request & { cfAccess?: CfAccessClaims }).cfAccess = result.claims;
    next();
  });
}
