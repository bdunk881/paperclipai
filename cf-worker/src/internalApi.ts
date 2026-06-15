/**
 * HEL-798 (Sub-phase B / B1) — Worker → API internal-call client.
 *
 * Mints the short-lived HS256 JWT that the Fly API's `requireCfWorker`
 * middleware (src/middleware/requireCfWorker.ts) accepts, then calls back into
 * `/api/internal/*`. This is the foundation B2 (the ydoc authorize + snapshot
 * routes) and B5 (the DO → Postgres snapshot mirror) build on.
 *
 * Token contract (must match requireCfWorker exactly):
 *   - alg HS256, signed with CF_WORKER_SHARED_SECRET (shared with the API)
 *   - iss "cf-worker"
 *   - aud CF_WORKER_INTERNAL_JWT_AUDIENCE (default "autoflow-api-internal")
 *   - exp - iat <= 30s (we mint 25s, comfortably under the cap)
 *   - sub identifies the caller
 *
 * jose uses Web Crypto (SubtleCrypto), which is native to the Workers runtime —
 * no nodejs_compat needed for the signing path.
 */
import { SignJWT } from "jose";

const ISSUER = "cf-worker";
const DEFAULT_AUDIENCE = "autoflow-api-internal";
// Under the API's 30s `exp - iat` cap, with headroom for clock skew.
const TOKEN_TTL_SECONDS = 25;

type MintEnv = {
  CF_WORKER_SHARED_SECRET?: string;
  CF_WORKER_INTERNAL_JWT_AUDIENCE?: string;
};

type CallEnv = MintEnv & { API_BASE_URL?: string };

/**
 * Mint a short-lived HS256 token the API's `requireCfWorker` will accept.
 * Throws (fail-closed) when the shared secret is missing — never sign with an
 * empty secret, which would mint a forgeable/garbage token.
 */
export async function mintInternalToken(env: MintEnv, sub = "cf-worker"): Promise<string> {
  const secret = env.CF_WORKER_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("CF_WORKER_SHARED_SECRET is not configured on the Worker");
  }
  const audience = env.CF_WORKER_INTERNAL_JWT_AUDIENCE?.trim() || DEFAULT_AUDIENCE;
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setAudience(audience)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Mint a token and call `${API_BASE_URL}/api/internal/<path>` with it. Callers
 * pass the path WITHOUT the `/api/internal/` prefix (e.g. `"__health"`).
 */
export async function callInternalApi(
  env: CallEnv,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await mintInternalToken(env);
  const base = (env.API_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("API_BASE_URL is not configured on the Worker");
  }
  const url = `${base}/api/internal/${path.replace(/^\/+/, "")}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
