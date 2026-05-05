import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type SupabaseAuthConfig = {
  audiences: [string, ...string[]];
  issuer: string;
  jwksUri: string;
  projectUrl: string;
};

export type SupabaseJwtClaims = JWTPayload & {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeHttpsUrl(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }

    return url.toString().replace(/\/+$/, "");
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

export function resolveSupabaseAuthConfig(): SupabaseAuthConfig | null {
  const projectUrl = normalizeHttpsUrl(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  if (!projectUrl) {
    return null;
  }

  const configuredAudiences = parseDelimitedEnv(process.env.SUPABASE_JWT_AUDIENCES);
  const audienceValues = configuredAudiences.length > 0 ? configuredAudiences : ["authenticated"];
  const issuer = `${projectUrl}/auth/v1`;

  return {
    projectUrl,
    issuer,
    audiences: audienceValues as [string, ...string[]],
    jwksUri: `${issuer}/.well-known/jwks.json`,
  };
}

function getRemoteJwks(jwksUri: string) {
  const cached = remoteJwksCache.get(jwksUri);
  if (cached) {
    return cached;
  }

  const remoteJwks = createRemoteJWKSet(new URL(jwksUri));
  remoteJwksCache.set(jwksUri, remoteJwks);
  return remoteJwks;
}

export async function verifySupabaseTokenWithDiagnostics(token: string): Promise<{
  claims: SupabaseJwtClaims | null;
  errorMessage?: string;
  errorName?: string;
}> {
  const config = resolveSupabaseAuthConfig();
  if (!config) {
    return { claims: null, errorMessage: "SUPABASE_URL is not configured." };
  }

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(config.jwksUri), {
      issuer: config.issuer,
      audience: config.audiences,
    });

    return {
      claims: payload as SupabaseJwtClaims,
    };
  } catch (error) {
    return {
      claims: null,
      errorMessage: error instanceof Error ? error.message : "Unknown token verification error.",
      errorName: error instanceof Error ? error.name : undefined,
    };
  }
}
