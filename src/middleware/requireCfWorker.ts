/**
 * Express middleware that verifies a JWT minted by the Cloudflare Worker
 * (cf-worker/) so the Worker can call back into the API on
 * /api/internal/* without re-exposing user-facing auth.
 *
 * Token shape:
 *   - alg: HS256
 *   - iss: "cf-worker"
 *   - aud: process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE (default "autoflow-api-internal")
 *   - exp - iat <= 30 seconds (defense against long-lived stolen tokens)
 *   - secret: process.env.CF_WORKER_SHARED_SECRET (also configured on the Worker via `wrangler secret put`)
 *
 * No code in this PR actually mints a token — the Worker just needs to
 * exist first. HEL-292+ will populate the call sites.
 */
import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

const ISSUER = "cf-worker";
const DEFAULT_AUDIENCE = "autoflow-api-internal";
const MAX_TOKEN_LIFETIME_SECONDS = 30;

export interface CfWorkerClaims {
  sub: string;
  iat: number;
  exp: number;
  aud: string;
  iss: string;
}

export interface CfWorkerRequest extends Request {
  cfWorker?: CfWorkerClaims;
}

function resolveConfig(): { secret: string; audience: string } | null {
  const secret = process.env.CF_WORKER_SHARED_SECRET?.trim();
  if (!secret) {
    return null;
  }
  const audience = process.env.CF_WORKER_INTERNAL_JWT_AUDIENCE?.trim() || DEFAULT_AUDIENCE;
  return { secret, audience };
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token.trim() || null;
}

export function requireCfWorker(req: Request, res: Response, next: NextFunction): void {
  const config = resolveConfig();
  if (!config) {
    // Don't 200 a misconfigured environment as if the auth passed —
    // 503 makes the bootstrap problem visible immediately.
    res.status(503).json({ error: "CF_WORKER_SHARED_SECRET is not configured" });
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  let decoded: JwtPayload | string;
  try {
    decoded = jwt.verify(token, config.secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: config.audience,
    });
  } catch {
    // Don't leak the verification failure mode (expired vs bad signature
    // vs wrong issuer) — a single 401 is enough for the caller.
    res.status(401).json({ error: "Invalid cf-worker token" });
    return;
  }

  if (typeof decoded !== "object" || decoded === null) {
    res.status(401).json({ error: "Invalid cf-worker token payload" });
    return;
  }

  const { sub, iat, exp, aud, iss } = decoded as JwtPayload;
  if (
    typeof sub !== "string" ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof aud !== "string" ||
    typeof iss !== "string"
  ) {
    res.status(401).json({ error: "Invalid cf-worker token claims" });
    return;
  }

  if (exp - iat > MAX_TOKEN_LIFETIME_SECONDS) {
    res.status(401).json({ error: "cf-worker token lifetime exceeds 30s cap" });
    return;
  }

  (req as CfWorkerRequest).cfWorker = { sub, iat, exp, aud, iss };
  next();
}
