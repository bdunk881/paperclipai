import type { Request } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type SocialAuthProvider = "google" | "facebook" | "apple";

export type AppJwtConfig = {
  audience: string;
  expiresIn: string;
  issuer: string;
  secret: string;
};

export type SocialAuthState = {
  redirectUri?: string;
};

export type AppUserTokenClaims = JwtPayload & {
  sub: string;
  email?: string;
  name?: string;
  provider?: SocialAuthProvider;
};

const DEFAULT_APP_JWT_AUDIENCE = "autoflow-api";
const DEFAULT_APP_JWT_ISSUER = "autoflow-app";
const DEFAULT_APP_JWT_EXPIRES_IN = "1h";

function normalizeMultilineEnv(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\\n/g, "\n");
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

export function resolveAppJwtConfig(): AppJwtConfig | null {
  const secret = normalizeMultilineEnv(process.env.APP_JWT_SECRET);
  if (!secret) {
    return null;
  }

  return {
    secret,
    issuer: process.env.APP_JWT_ISSUER?.trim() || DEFAULT_APP_JWT_ISSUER,
    audience: process.env.APP_JWT_AUDIENCE?.trim() || DEFAULT_APP_JWT_AUDIENCE,
    expiresIn: process.env.APP_JWT_EXPIRES_IN?.trim() || DEFAULT_APP_JWT_EXPIRES_IN,
  };
}

export function signAppUserToken(user: {
  id: string;
  email?: string | null;
  displayName?: string | null;
  provider?: SocialAuthProvider;
}): string {
  const config = resolveAppJwtConfig();
  if (!config) {
    throw new Error("APP_JWT_SECRET is required for social auth");
  }

  return jwt.sign(
    {
      sub: user.id,
      email: user.email ?? undefined,
      name: user.displayName ?? undefined,
      provider: user.provider,
    },
    config.secret,
    {
      algorithm: "HS256",
      issuer: config.issuer,
      audience: config.audience,
      expiresIn: config.expiresIn as jwt.SignOptions["expiresIn"],
    }
  );
}

export function verifyAppUserToken(token: string): AppUserTokenClaims | null {
  return verifyAppUserTokenWithDiagnostics(token).claims;
}

export function verifyAppUserTokenWithDiagnostics(token: string): {
  claims: AppUserTokenClaims | null;
  errorMessage?: string;
} {
  const config = resolveAppJwtConfig();
  if (!config) {
    return { claims: null, errorMessage: "APP_JWT_SECRET is not configured." };
  }

  try {
    return {
      claims: jwt.verify(token, config.secret, {
        algorithms: ["HS256"],
        issuer: config.issuer,
        audience: config.audience,
      }) as AppUserTokenClaims,
    };
  } catch (error) {
    return {
      claims: null,
      errorMessage: error instanceof Error ? error.message : "Unknown token verification error.",
    };
  }
}

export function createSocialAuthState(state: SocialAuthState): string {
  const config = resolveAppJwtConfig();
  if (!config) {
    throw new Error("APP_JWT_SECRET is required for social auth");
  }

  return jwt.sign(
    {
      type: "social_auth_state",
      redirectUri: state.redirectUri,
    },
    config.secret,
    {
      algorithm: "HS256",
      issuer: config.issuer,
      audience: `${config.audience}:state`,
      expiresIn: "10m" as jwt.SignOptions["expiresIn"],
    }
  );
}

export function parseSocialAuthState(token: string | undefined): SocialAuthState | null {
  if (!token) {
    return null;
  }

  const config = resolveAppJwtConfig();
  if (!config) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, config.secret, {
      algorithms: ["HS256"],
      issuer: config.issuer,
      audience: `${config.audience}:state`,
    }) as JwtPayload & { redirectUri?: string; type?: string };

    if (decoded.type !== "social_auth_state") {
      return null;
    }

    return {
      redirectUri: typeof decoded.redirectUri === "string" ? decoded.redirectUri : undefined,
    };
  } catch {
    return null;
  }
}

export function readSocialAuthState(req: Request): string | undefined {
  const queryState = req.query.state;
  if (typeof queryState === "string" && queryState.trim()) {
    return queryState.trim();
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyState = body?.state;
  return typeof bodyState === "string" && bodyState.trim() ? bodyState.trim() : undefined;
}

export function isAllowedSocialRedirectUri(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const configuredOrigins = new Set([
      ...parseDelimitedEnv(process.env.AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS),
      ...parseDelimitedEnv(process.env.ALLOWED_ORIGINS),
    ]);
    return configuredOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

export function resolveSocialAuthDashboardCallbackUrl(): string | null {
  const dashboardBase = process.env.SOCIAL_AUTH_DASHBOARD_URL?.trim();
  if (!dashboardBase) {
    return null;
  }

  try {
    const target = new URL(dashboardBase);
    target.pathname = `${target.pathname.replace(/\/+$/, "")}/auth/social-callback`;
    target.search = "";
    target.hash = "";
    return target.toString();
  } catch {
    return null;
  }
}

export function buildSocialAuthRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>
): string {
  const fragment = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      fragment.set(key, value);
    }
  }

  const target = new URL(redirectUri);
  target.hash = fragment.toString();
  return target.toString();
}
