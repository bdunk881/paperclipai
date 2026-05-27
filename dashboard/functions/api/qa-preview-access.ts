/**
 * QA preview access — Cloudflare Pages Function.
 *
 * Replaces the old Vercel serverless function at dashboard/api/qa-preview-access.ts
 * (retired along with the Vercel deploy target). Same contract:
 *
 *   POST /api/qa-preview-access
 *   body: { token: string }
 *   200 → { accessToken, user }
 *   400 → token missing
 *   401 → token mismatch
 *   403 → not a preview deployment (and override flag is not set)
 *   405 → method not POST
 *   503 → APP_JWT_SECRET / QA_PREVIEW_ACCESS_TOKEN env not set
 *
 * Same-origin endpoint by design: the dashboard's preview deploys land on a
 * *.pages.dev URL that is NOT in the Express backend's CORS allowlist, so a
 * cross-origin POST to dev-api.helloautoflow.com would 403 on preflight. Pages
 * Functions run at the SAME origin as the dashboard, dodging the CORS issue
 * entirely. (This is the only place in the codebase that should be a Pages
 * Function — everything else routes through Express via baseUrl.ts.)
 *
 * Env vars (set on the Cloudflare Pages project, NOT in Infisical):
 *   - APP_JWT_SECRET                — same value the Express backend uses;
 *                                     keeps issued tokens verifiable by Express
 *   - QA_PREVIEW_ACCESS_TOKEN       — shared secret QA hits the endpoint with
 *   - QA_PREVIEW_DEPLOYMENT_KIND    — set to "preview" on preview-branch builds
 *                                     and absent (or "production") on prod. Was
 *                                     `VERCEL_ENV` previously; on CF Pages we
 *                                     set this explicitly via wrangler.toml's
 *                                     per-env vars or the Pages dashboard.
 *   - QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW (optional, dev/staging only)
 *                                  — set to "true" to bypass the preview gate
 *                                     for local smoke runs. Ignored when
 *                                     QA_PREVIEW_DEPLOYMENT_KIND is "production"
 *                                     or unset (fail-closed).
 *
 * Optional JWT issuer / audience / expiry env vars match the Express handler
 * so issued tokens look identical regardless of which surface signed them.
 */

const QA_PREVIEW_USER = {
  id: "qa-smoke-user",
  email: "qa-preview@autoflow.local",
  name: "QA Preview User",
} as const;

const DEFAULT_APP_JWT_AUDIENCE = "autoflow-api";
const DEFAULT_APP_JWT_ISSUER = "autoflow-app";
const DEFAULT_APP_JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60;

export interface QaPreviewEnv {
  APP_JWT_SECRET?: string;
  APP_JWT_ISSUER?: string;
  APP_JWT_AUDIENCE?: string;
  APP_JWT_EXPIRES_IN?: string;
  QA_PREVIEW_ACCESS_TOKEN?: string;
  QA_PREVIEW_DEPLOYMENT_KIND?: string;
  QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: QaPreviewEnv;
}

function normalize(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\\n/g, "\n");
  return trimmed ? trimmed : null;
}

function parseJwtExpirySeconds(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const match = normalized.match(/^(\d+)([smhd])$/i);
  if (!match) return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 60 * 60 : 60 * 60 * 24;
  return amount * multiplier;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // CF Pages runs on V8/workerd which exposes btoa()
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(input: string): string {
  return base64UrlEncode(new TextEncoder().encode(input));
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64UrlEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncodeString(JSON.stringify(payload));
  const data = `${header}.${body}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(sigBuf))}`;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  const { request, env } = context;

  const deploymentKind = normalize(env.QA_PREVIEW_DEPLOYMENT_KIND);
  const allowNonPreview =
    deploymentKind !== "production" &&
    env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW === "true";

  if (deploymentKind !== "preview" && !allowNonPreview) {
    return jsonResponse(403, {
      error: "QA preview access is only enabled on preview deployments",
    });
  }

  const expectedToken = normalize(env.QA_PREVIEW_ACCESS_TOKEN);
  if (!expectedToken) {
    return jsonResponse(503, { error: "QA preview access is not configured" });
  }

  let bodyToken: string | null = null;
  try {
    const parsed = (await request.json()) as { token?: unknown };
    if (typeof parsed.token === "string") {
      bodyToken = normalize(parsed.token);
    }
  } catch {
    // fall through — bodyToken stays null and we'll return 400 below
  }

  if (!bodyToken) {
    return jsonResponse(400, { error: "token is required" });
  }

  if (!timingSafeEqualStrings(bodyToken, expectedToken)) {
    return jsonResponse(401, { error: "invalid preview access token" });
  }

  const secret = normalize(env.APP_JWT_SECRET);
  if (!secret) {
    return jsonResponse(503, { error: "QA preview access is not fully configured" });
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(
    {
      sub: QA_PREVIEW_USER.id,
      email: QA_PREVIEW_USER.email,
      name: QA_PREVIEW_USER.name,
      iss: normalize(env.APP_JWT_ISSUER) ?? DEFAULT_APP_JWT_ISSUER,
      aud: normalize(env.APP_JWT_AUDIENCE) ?? DEFAULT_APP_JWT_AUDIENCE,
      iat: now,
      exp: now + parseJwtExpirySeconds(env.APP_JWT_EXPIRES_IN),
    },
    secret,
  );

  return jsonResponse(200, { accessToken, user: QA_PREVIEW_USER });
}

// Any non-POST request gets a 405 with a consistent shape.
export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return jsonResponse(405, { error: "Method not allowed" });
}
