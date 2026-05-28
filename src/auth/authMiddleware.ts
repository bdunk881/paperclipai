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
  exp?: number | null;
  nbf?: number | null;
  // DASH-30: forensic fields for diagnosing "who sent this stale token?"
  // Decoded but UNVERIFIED — only used in failure-log context, never
  // for auth decisions.
  sub?: string;
  email?: string;
  iat?: number | null;
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
      exp: Object.prototype.hasOwnProperty.call(parsed, "exp")
        ? typeof parsed.exp === "number"
          ? parsed.exp
          : null
        : undefined,
      nbf: Object.prototype.hasOwnProperty.call(parsed, "nbf")
        ? typeof parsed.nbf === "number"
          ? parsed.nbf
          : null
        : undefined,
      sub: typeof parsed.sub === "string" ? parsed.sub : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      iat: Object.prototype.hasOwnProperty.call(parsed, "iat")
        ? typeof parsed.iat === "number"
          ? parsed.iat
          : null
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * DASH-30: pull request context onto JWT failure logs so we can identify
 * WHO/WHAT is sending stale tokens. Without this, every JWTExpired line
 * looks identical and forensics is impossible. Returns the small subset
 * we want in logs + Sentry — never the Authorization header (logging
 * raw bearer tokens is a security incident vector).
 */
function describeRequestForAuthLog(req: Request): {
  method: string;
  path: string;
  ip: string;
  userAgent: string | undefined;
  referer: string | undefined;
  cfRay: string | undefined;
  forwarded: string | undefined;
} {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    // req.ip respects the trust-proxy setting; falls back to socket
    ip: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: firstString(req.headers["user-agent"]),
    referer: firstString(req.headers["referer"] ?? req.headers["referrer"]),
    cfRay: firstString(req.headers["cf-ray"]),
    forwarded: firstString(req.headers["x-forwarded-for"]),
  };
}

function ageSeconds(epochSeconds: number | null | undefined): number | undefined {
  if (typeof epochSeconds !== "number") return undefined;
  return Math.round(Date.now() / 1000) - epochSeconds;
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

function logAppJwtVerificationFailure(
  errorMessage: string,
  tokenClaims: JwtDiagnosticClaims | null,
  expectedAudience: string,
  expectedIssuer: string
): void {
  console.warn("[auth] App JWT verification failed", errorMessage, {
    tokenAud: tokenClaims?.aud,
    tokenIss: tokenClaims?.iss,
    tokenExp: tokenClaims?.exp,
    tokenNbf: tokenClaims?.nbf,
    expectedAudience,
    expectedIssuer,
  });
}

export type AuthAssuranceLevel = "aal1" | "aal2";

export interface AuthAmrEntry {
  method: string;
  timestamp: number;
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
    workspaceId?: string;
    sessionId?: string;
    aal?: AuthAssuranceLevel;
    amr?: AuthAmrEntry[];
  };
}

function resolveWorkspaceClaim(payload: JwtPayload): string | undefined {
  const directCandidates = [
    payload["workspaceId"],
    payload["workspace_id"],
    payload["extension_workspaceId"],
    payload["extension_workspace_id"],
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

function parseAalClaim(value: unknown): AuthAssuranceLevel | undefined {
  if (value === "aal1" || value === "aal2") return value;
  return undefined;
}

function parseAmrClaim(value: unknown): AuthAmrEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: AuthAmrEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const method = typeof obj.method === "string" ? obj.method.trim() : "";
    const timestamp = typeof obj.timestamp === "number" ? obj.timestamp : Number(obj.timestamp);
    if (!method || !Number.isFinite(timestamp)) continue;
    entries.push({ method, timestamp });
  }
  return entries.length > 0 ? entries : undefined;
}

function supabaseClaimsToAuth(claims: JwtPayload): NonNullable<AuthenticatedRequest["auth"]> {
  const appMetadata = claims.app_metadata as Record<string, unknown> | undefined;
  const userMetadata = claims.user_metadata as Record<string, unknown> | undefined;

  return {
    sub: String(claims.sub),
    email: firstString(claims.email) ?? firstString(claims.phone),
    name:
      firstString(userMetadata?.full_name) ??
      firstString(userMetadata?.name) ??
      firstString(claims.email) ??
      firstString(claims.phone),
    provider: firstString(appMetadata?.provider) ?? "supabase",
    issuer: firstString(claims.iss),
    workspaceId: resolveWorkspaceClaim(claims),
    sessionId: firstString(claims.session_id),
    aal: parseAalClaim(claims["aal"]),
    amr: parseAmrClaim(claims["amr"]),
  };
}

function attachSupabaseAuth(req: AuthenticatedRequest, claims: JwtPayload): void {
  req.auth = supabaseClaimsToAuth(claims);
}

/**
 * Diagnostic context passed to `verifyBearerToken` so failure logs can identify
 * the caller (Express request vs. WebSocket upgrade vs. test harness). Keeps
 * the same DASH-30 forensics that `requireAuth` writes on token failures.
 */
export interface VerifyTokenDiagnostics {
  source: string;
  request?: ReturnType<typeof describeRequestForAuthLog>;
}

/**
 * Tri-state result so callers can distinguish "auth misconfigured" (503) from
 * "token bad" (401). Lets `requireAuth` and the WebSocket upgrade handler
 * surface different status codes against the same verification core.
 */
export type VerifyBearerTokenResult =
  | { kind: "ok"; auth: NonNullable<AuthenticatedRequest["auth"]> }
  | { kind: "invalid" }
  | { kind: "auth_not_configured" };

/**
 * Sync App-JWT path. Returns `null` when the configured app issuer can't
 * recognize the token (so the caller should fall through to Supabase),
 * otherwise returns a settled result. Kept synchronous so `requireAuth` can
 * preserve its original "App tokens resolve in the same tick" behavior.
 */
function tryVerifyAppJwt(token: string): VerifyBearerTokenResult | null {
  const appAuthConfig = resolveAppJwtConfig();
  if (!appAuthConfig) return null;

  const tokenClaims = decodeJwtDiagnosticClaims(token);
  const looksLikeAppToken =
    tokenClaims?.iss === appAuthConfig.issuer ||
    tokenClaims?.aud === appAuthConfig.audience ||
    (Array.isArray(tokenClaims?.aud) && tokenClaims.aud.includes(appAuthConfig.audience));

  if (looksLikeAppToken && typeof tokenClaims?.exp !== "number") {
    logAppJwtVerificationFailure(
      "App token is missing a numeric exp claim.",
      tokenClaims,
      appAuthConfig.audience,
      appAuthConfig.issuer
    );
    return { kind: "invalid" };
  }

  const { claims: appClaims, errorMessage } = verifyAppUserTokenWithDiagnostics(token);
  if (appClaims?.sub) {
    return {
      kind: "ok",
      auth: {
        sub: appClaims.sub,
        email: appClaims.email,
        name: appClaims.name,
        provider: appClaims.provider,
        issuer: appClaims.iss,
        workspaceId: appClaims.workspaceId,
      },
    };
  }

  if (looksLikeAppToken) {
    logAppJwtVerificationFailure(
      errorMessage ?? "Unknown token verification error.",
      tokenClaims,
      appAuthConfig.audience,
      appAuthConfig.issuer
    );
    return { kind: "invalid" };
  }

  return null;
}

/**
 * Plain `.then()` chain (not async/await) so the microtask depth matches the
 * original `requireAuth` Supabase path — tests assume one `await Promise.resolve()`
 * is enough to settle. Adding an async wrapper layer adds a second hop and
 * silently breaks downstream awaits.
 */
function verifySupabaseJwt(
  token: string,
  diagnostics: VerifyTokenDiagnostics,
): Promise<VerifyBearerTokenResult> {
  const supabaseAuthConfig = resolveSupabaseAuthConfig();
  if (!supabaseAuthConfig) {
    return Promise.resolve({ kind: "auth_not_configured" });
  }

  const tokenClaims = decodeJwtDiagnosticClaims(token);

  const logFailure = (
    errName: string | undefined,
    errMessage: string | undefined,
  ): void => {
    console.warn("[auth] Supabase JWT verification failed", {
      errName,
      errMessage,
      source: diagnostics.source,
      tokenSub: tokenClaims?.sub,
      tokenEmail: tokenClaims?.email,
      tokenAud: tokenClaims?.aud,
      tokenIss: tokenClaims?.iss,
      tokenIat: tokenClaims?.iat,
      tokenExp: tokenClaims?.exp,
      tokenNbf: tokenClaims?.nbf,
      tokenAgeSeconds: ageSeconds(tokenClaims?.iat),
      tokenExpiredSecondsAgo: ageSeconds(tokenClaims?.exp),
      expectedAudiences: supabaseAuthConfig.audiences,
      expectedIssuer: supabaseAuthConfig.issuer,
      jwksUri: supabaseAuthConfig.jwksUri,
      request: diagnostics.request,
    });
  };

  return verifySupabaseTokenWithDiagnostics(token).then(
    ({ claims, errorMessage, errorName }): VerifyBearerTokenResult => {
      if (!claims?.sub) {
        logFailure(errorName, errorMessage);
        return { kind: "invalid" };
      }
      return { kind: "ok", auth: supabaseClaimsToAuth(claims) };
    },
    (error: unknown): VerifyBearerTokenResult => {
      logFailure(
        error instanceof Error ? error.name : "UnknownError",
        error instanceof Error ? error.message : "Unknown token verification error.",
      );
      return { kind: "invalid" };
    },
  );
}

/**
 * Token-verification core lifted out of `requireAuth` (HEL-286) so the
 * WebSocket upgrade path can reuse the same app-JWT → Supabase-JWT chain
 * without rebuilding the Express request shape. `requireAuth` keeps using
 * the sync App path + async Supabase path directly so its observable timing
 * stays byte-equivalent; this wrapper is for callers that don't care.
 */
export async function verifyBearerToken(
  token: string,
  diagnostics: VerifyTokenDiagnostics = { source: "lib" },
): Promise<VerifyBearerTokenResult> {
  const appResult = tryVerifyAppJwt(token);
  if (appResult) return appResult;
  return verifySupabaseJwt(token, diagnostics);
}

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

  // Sync App-JWT fast path — preserves original requireAuth timing so
  // callers/tests that assert immediately after requireAuth(...) still see
  // 401/200 from this branch.
  const appResult = tryVerifyAppJwt(token);
  if (appResult) {
    if (appResult.kind === "ok") {
      req.auth = appResult.auth;
      next();
      return;
    }
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }

  // Sync 503 fast path — original requireAuth raised this in the same tick
  // before kicking off Supabase verification. Tests assert immediately.
  if (!resolveSupabaseAuthConfig()) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  // DASH-30: capture request context BEFORE the async verify so it's bound
  // to whichever failure branch fires below.
  const requestContext = describeRequestForAuthLog(req);

  void verifySupabaseJwt(token, { source: "express", request: requestContext })
    .then((result) => {
      if (result.kind === "auth_not_configured") {
        // Belt-and-suspenders: covered by the sync pre-check above.
        res.status(503).json({ error: "Auth service not configured." });
        return;
      }
      if (result.kind === "invalid") {
        res.status(401).json({ error: "Invalid or expired token." });
        return;
      }
      req.auth = result.auth;
      next();
    })
    .catch((error: unknown) => {
      console.warn(
        "[auth] Bearer verification threw",
        error instanceof Error ? error.message : String(error),
      );
      res.status(401).json({ error: "Invalid or expired token." });
    });
}

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
