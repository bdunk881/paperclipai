/**
 * HEL-801 (Sub-phase B4) — Supabase access-token verification at the Worker edge.
 *
 * Runtime-agnostic mirror of the API's `src/auth/supabaseAuth.ts`
 * (`resolveSupabaseAuthConfig` / `verifySupabaseTokenWithDiagnostics`): the edge
 * and the API MUST derive an identical issuer / audience / JWKS URI so a token
 * the API would accept is the same one the edge accepts. This module takes the
 * raw inputs (no `process.env`, no Worker `env`) so both runtimes compute the
 * same expectations — keep it in lock-step with src/auth/supabaseAuth.ts.
 *
 * jose runs on Web Crypto, native to Workers.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface SupabaseJwtConfig {
  issuer: string;
  audiences: [string, ...string[]];
  jwksUri: string;
}

export interface VerifiedAccess {
  userId: string;
}

function normalizeHttpsUrl(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
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

function parseCsv(value: string | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Derive { issuer, audiences, jwksUri } from the Supabase project URL the exact
 * way the API does. Returns null when the URL is missing/invalid — callers must
 * fail CLOSED (reject the connection) rather than skip verification.
 */
export function deriveSupabaseJwtConfig(
  supabaseUrl: string | undefined,
  audiencesCsv?: string,
): SupabaseJwtConfig | null {
  const projectUrl = normalizeHttpsUrl(supabaseUrl);
  if (!projectUrl) return null;
  const configured = parseCsv(audiencesCsv);
  const audiences = (configured.length > 0 ? configured : ["authenticated"]) as [
    string,
    ...string[],
  ];
  const issuer = `${projectUrl}/auth/v1`;
  return { issuer, audiences, jwksUri: `${issuer}/.well-known/jwks.json` };
}

// allowlist: process-local cache of remote JWKS resolvers, keyed by jwksUri.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let resolver = jwksCache.get(jwksUri);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, resolver);
  }
  return resolver;
}

/**
 * Verify a Supabase access token and return the user id (`sub`). Returns null on
 * any failure (bad signature, wrong issuer/audience, expired, missing sub) — the
 * caller treats null as "reject with 401". `jwks` is injectable so tests can
 * supply a local key set; production uses the cached remote JWKS.
 */
export async function verifySupabaseAccessToken(
  token: string,
  config: SupabaseJwtConfig,
  jwks: JWTVerifyGetKey = remoteJwks(config.jwksUri),
): Promise<VerifiedAccess | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audiences,
    });
    const userId = typeof payload.sub === "string" ? payload.sub.trim() : "";
    return userId ? { userId } : null;
  } catch {
    return null;
  }
}
